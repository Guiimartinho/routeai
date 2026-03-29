package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"routeai/api/config"
	"routeai/api/db"
	"routeai/api/middleware"
	"routeai/api/models"
)

type AuthHandler struct {
	Config *config.Config
}

func NewAuthHandler(cfg *config.Config) *AuthHandler {
	return &AuthHandler{Config: cfg}
}

// Register creates a new user account.
func (h *AuthHandler) Register(c *gin.Context) {
	var req models.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error:   "invalid request body",
			Details: err.Error(),
		})
		return
	}

	// Check if email already exists.
	existing, _ := db.GetUserByEmail(req.Email)
	if existing != nil {
		c.JSON(http.StatusConflict, models.ErrorResponse{
			Error: "email already registered",
			Code:  "EMAIL_EXISTS",
		})
		return
	}

	// Hash the password.
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: "failed to hash password",
		})
		return
	}

	user := &models.User{
		Email:        req.Email,
		PasswordHash: string(hash),
		Name:         req.Name,
		Tier:         "free",
	}

	if err := db.CreateUser(user); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error:   "failed to create user",
			Details: err.Error(),
		})
		return
	}

	// Generate tokens.
	accessToken, err := h.generateAccessToken(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: "failed to generate token",
		})
		return
	}

	refreshToken, err := h.generateRefreshToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: "failed to generate refresh token",
		})
		return
	}

	c.JSON(http.StatusCreated, models.AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    h.Config.JWT.ExpiryHours * 3600,
		User:         *user,
	})
}

// Login authenticates a user and returns JWT tokens.
func (h *AuthHandler) Login(c *gin.Context) {
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error:   "invalid request body",
			Details: err.Error(),
		})
		return
	}

	user, err := db.GetUserByEmail(req.Email)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse{
				Error: "invalid email or password",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: "database error",
		})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{
			Error: "invalid email or password",
		})
		return
	}

	accessToken, err := h.generateAccessToken(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: "failed to generate token",
		})
		return
	}

	refreshToken, err := h.generateRefreshToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: "failed to generate refresh token",
		})
		return
	}

	c.JSON(http.StatusOK, models.AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    h.Config.JWT.ExpiryHours * 3600,
		User:         *user,
	})
}

// Refresh issues a new access token using a refresh token.
func (h *AuthHandler) Refresh(c *gin.Context) {
	var req models.RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error:   "invalid request body",
			Details: err.Error(),
		})
		return
	}

	// In production, validate refresh token against database.
	// For now, require a valid user context from the access token.
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{
			Error: "authentication required",
		})
		return
	}

	user, err := db.GetUserByID(userID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{
			Error: "user not found",
		})
		return
	}

	accessToken, err := h.generateAccessToken(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: "failed to generate token",
		})
		return
	}

	refreshToken, err := h.generateRefreshToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: "failed to generate refresh token",
		})
		return
	}

	c.JSON(http.StatusOK, models.AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    h.Config.JWT.ExpiryHours * 3600,
		User:         *user,
	})
}

// Me returns the current authenticated user.
func (h *AuthHandler) Me(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{
			Error: "authentication required",
		})
		return
	}

	user, err := db.GetUserByID(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{
			Error: "user not found",
		})
		return
	}

	c.JSON(http.StatusOK, user)
}

// GetUsage handles GET /api/v1/user/usage
// Returns review count, tier, and limits for the current user.
func (h *AuthHandler) GetUsage(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{
			Error: "authentication required",
		})
		return
	}

	user, err := db.GetUserByID(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{
			Error: "user not found",
		})
		return
	}

	reviewCount, err := db.CountUserReviewsThisMonth(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error:   "failed to query usage",
			Details: err.Error(),
		})
		return
	}

	// Determine the limit for the user's tier.
	var limit int
	switch user.Tier {
	case "pro":
		limit = h.Config.RateLimits.ProReviewsPerMonth
	case "team":
		limit = h.Config.RateLimits.TeamReviewsPerMonth
	default:
		limit = h.Config.RateLimits.FreeReviewsPerMonth
	}

	// A limit of 0 means unlimited.
	unlimited := limit == 0

	c.JSON(http.StatusOK, gin.H{
		"user_id":              userID.String(),
		"tier":                 user.Tier,
		"reviews_this_month":   reviewCount,
		"reviews_limit":        limit,
		"unlimited":            unlimited,
	})
}

func (h *AuthHandler) generateAccessToken(user *models.User) (string, error) {
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

func (h *AuthHandler) generateRefreshToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
