package handlers

// auth_dev.go — In-memory dev auth for running without PostgreSQL.
// Mirrors the Python auth_dev.py behavior: auto-creates users on first login,
// no bcrypt, simple token generation. NOT FOR PRODUCTION.

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"routeai/api/config"
	"routeai/api/middleware"
	"routeai/api/models"
)

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

type devUser struct {
	ID        uuid.UUID `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	Tier      string    `json:"tier"`
	Password  string    `json:"-"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type devProject struct {
	ID          uuid.UUID `json:"id"`
	UserID      uuid.UUID `json:"user_id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	Format      string    `json:"format"`
	StorageKey  string    `json:"storage_key"`
	FileSize    int64     `json:"file_size"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

var (
	devUsers    = map[string]*devUser{}    // email -> user
	devTokens   = map[string]string{}      // token -> email
	devProjects = map[uuid.UUID]*devProject{}
	devMu       sync.RWMutex
)

// ---------------------------------------------------------------------------
// DevAuthHandler — drop-in replacement for AuthHandler in dev mode
// ---------------------------------------------------------------------------

type DevAuthHandler struct {
	Config *config.Config
}

func NewDevAuthHandler(cfg *config.Config) *DevAuthHandler {
	return &DevAuthHandler{Config: cfg}
}

// wrap returns the {data, status} envelope the React frontend expects.
func wrap(data interface{}) gin.H {
	return gin.H{"data": data, "status": "ok"}
}

func wrapErr(msg string) gin.H {
	return gin.H{"data": nil, "status": "error", "message": msg}
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

func (h *DevAuthHandler) makeDevToken(user *devUser) (string, error) {
	now := time.Now()
	claims := middleware.Claims{
		UserID: user.ID,
		Email:  user.Email,
		Tier:   user.Tier,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    h.Config.JWT.Issuer,
			Subject:   user.ID.String(),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Duration(h.Config.JWT.ExpiryHours) * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ID:        uuid.New().String(),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(h.Config.JWT.Secret))
}

func makeRefreshToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate refresh token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// ---------------------------------------------------------------------------
// getOrCreateUser — auto-creates on first encounter (dev convenience).
// ---------------------------------------------------------------------------

func getOrCreateUser(email, password, name string) *devUser {
	devMu.Lock()
	defer devMu.Unlock()

	if u, ok := devUsers[email]; ok {
		return u
	}

	if name == "" {
		name = strings.Split(email, "@")[0]
	}

	now := time.Now()
	u := &devUser{
		ID:        uuid.New(),
		Email:     email,
		Name:      name,
		Tier:      "pro",
		Password:  password,
		CreatedAt: now,
		UpdatedAt: now,
	}
	devUsers[email] = u
	return u
}

func devUserToMap(u *devUser) gin.H {
	return gin.H{
		"id":         u.ID.String(),
		"email":      u.Email,
		"name":       u.Name,
		"tier":       u.Tier,
		"created_at": u.CreatedAt.Format(time.RFC3339),
		"updated_at": u.UpdatedAt.Format(time.RFC3339),
	}
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/register
// ---------------------------------------------------------------------------

func (h *DevAuthHandler) Register(c *gin.Context) {
	var req models.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, wrapErr("invalid request body"))
		return
	}

	devMu.RLock()
	_, exists := devUsers[req.Email]
	devMu.RUnlock()

	if exists {
		c.JSON(http.StatusConflict, wrapErr("email already registered"))
		return
	}

	user := getOrCreateUser(req.Email, req.Password, req.Name)

	accessToken, err := h.makeDevToken(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, wrapErr("failed to generate token"))
		return
	}

	refreshToken, err := makeRefreshToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, wrapErr("failed to generate refresh token"))
		return
	}

	devMu.Lock()
	devTokens[accessToken] = user.Email
	devMu.Unlock()

	c.JSON(http.StatusCreated, wrap(gin.H{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"expires_in":    h.Config.JWT.ExpiryHours * 3600,
		"user":          devUserToMap(user),
	}))
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/login
// ---------------------------------------------------------------------------

func (h *DevAuthHandler) Login(c *gin.Context) {
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, wrapErr("invalid request body"))
		return
	}

	// Dev mode: auto-create on first login, accept any password.
	user := getOrCreateUser(req.Email, req.Password, "")

	accessToken, err := h.makeDevToken(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, wrapErr("failed to generate token"))
		return
	}

	refreshToken, err := makeRefreshToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, wrapErr("failed to generate refresh token"))
		return
	}

	devMu.Lock()
	devTokens[accessToken] = user.Email
	devMu.Unlock()

	c.JSON(http.StatusOK, wrap(gin.H{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"expires_in":    h.Config.JWT.ExpiryHours * 3600,
		"user":          devUserToMap(user),
	}))
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/refresh
// ---------------------------------------------------------------------------

func (h *DevAuthHandler) Refresh(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, wrapErr("authentication required"))
		return
	}

	// Find user by ID.
	devMu.RLock()
	var user *devUser
	for _, u := range devUsers {
		if u.ID == userID {
			user = u
			break
		}
	}
	devMu.RUnlock()

	if user == nil {
		c.JSON(http.StatusUnauthorized, wrapErr("user not found"))
		return
	}

	accessToken, err := h.makeDevToken(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, wrapErr("failed to generate token"))
		return
	}

	refreshToken, err := makeRefreshToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, wrapErr("failed to generate refresh token"))
		return
	}

	c.JSON(http.StatusOK, wrap(gin.H{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"expires_in":    h.Config.JWT.ExpiryHours * 3600,
		"user":          devUserToMap(user),
	}))
}

// ---------------------------------------------------------------------------
// GET /api/v1/auth/me
// ---------------------------------------------------------------------------

func (h *DevAuthHandler) Me(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, wrapErr("authentication required"))
		return
	}

	devMu.RLock()
	var user *devUser
	for _, u := range devUsers {
		if u.ID == userID {
			user = u
			break
		}
	}
	devMu.RUnlock()

	if user == nil {
		c.JSON(http.StatusNotFound, wrapErr("user not found"))
		return
	}

	c.JSON(http.StatusOK, wrap(gin.H{
		"id":    user.ID.String(),
		"email": user.Email,
		"name":  user.Name,
		"tier":  user.Tier,
	}))
}

// ---------------------------------------------------------------------------
// GET /api/v1/user/usage  (dev stub)
// ---------------------------------------------------------------------------

func (h *DevAuthHandler) GetUsage(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, wrapErr("authentication required"))
		return
	}

	c.JSON(http.StatusOK, wrap(gin.H{
		"user_id":            userID.String(),
		"tier":               "pro",
		"reviews_this_month": 0,
		"reviews_limit":      999,
		"unlimited":          true,
	}))
}

// ---------------------------------------------------------------------------
// DevProjectHandler — in-memory project CRUD for dev mode
// ---------------------------------------------------------------------------

type DevProjectHandler struct {
	Config *config.Config
}

func NewDevProjectHandler(cfg *config.Config) *DevProjectHandler {
	return &DevProjectHandler{Config: cfg}
}

// POST /api/v1/projects
func (h *DevProjectHandler) CreateProject(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, wrapErr("authentication required"))
		return
	}

	name := c.PostForm("name")
	if name == "" {
		name = "Untitled Project"
	}
	description := c.PostForm("description")

	now := time.Now()
	p := &devProject{
		ID:          uuid.New(),
		UserID:      userID,
		Name:        name,
		Description: description,
		Status:      "uploaded",
		Format:      "kicad",
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	devMu.Lock()
	devProjects[p.ID] = p
	devMu.Unlock()

	c.JSON(http.StatusCreated, wrap(devProjectToMap(p)))
}

// GET /api/v1/projects
func (h *DevProjectHandler) ListProjects(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, wrapErr("authentication required"))
		return
	}

	devMu.RLock()
	var projects []gin.H
	for _, p := range devProjects {
		if p.UserID == userID {
			projects = append(projects, devProjectToMap(p))
		}
	}
	devMu.RUnlock()

	if projects == nil {
		projects = []gin.H{}
	}

	c.JSON(http.StatusOK, wrap(projects))
}

// GET /api/v1/projects/:id
func (h *DevProjectHandler) GetProject(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, wrapErr("invalid project ID"))
		return
	}

	devMu.RLock()
	p, ok := devProjects[id]
	devMu.RUnlock()

	if !ok {
		c.JSON(http.StatusNotFound, wrapErr("project not found"))
		return
	}

	c.JSON(http.StatusOK, wrap(devProjectToMap(p)))
}

// DELETE /api/v1/projects/:id
func (h *DevProjectHandler) DeleteProject(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, wrapErr("invalid project ID"))
		return
	}

	devMu.Lock()
	delete(devProjects, id)
	devMu.Unlock()

	c.JSON(http.StatusOK, wrap(gin.H{"message": "deleted"}))
}

func devProjectToMap(p *devProject) gin.H {
	return gin.H{
		"id":          p.ID.String(),
		"user_id":     p.UserID.String(),
		"name":        p.Name,
		"description": p.Description,
		"status":      p.Status,
		"format":      p.Format,
		"storage_key": p.StorageKey,
		"file_size":   p.FileSize,
		"created_at":  p.CreatedAt.Format(time.RFC3339),
		"updated_at":  p.UpdatedAt.Format(time.RFC3339),
	}
}
