package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const testSecret = "test-jwt-secret-key-for-testing"

func init() {
	gin.SetMode(gin.TestMode)
}

func createTestToken(userID uuid.UUID, email, tier string, expiry time.Duration) string {
	now := time.Now()
	claims := Claims{
		UserID: userID,
		Email:  email,
		Tier:   tier,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(expiry)),
			IssuedAt:  jwt.NewNumericDate(now),
			Issuer:    "routeai",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, _ := token.SignedString([]byte(testSecret))
	return tokenStr
}

func TestAuthMiddleware_ValidToken(t *testing.T) {
	userID := uuid.New()
	token := createTestToken(userID, "test@example.com", "pro", 1*time.Hour)

	w := httptest.NewRecorder()
	c, r := gin.CreateTestContext(w)

	r.Use(AuthMiddleware(testSecret))
	r.GET("/test", func(c *gin.Context) {
		uid, ok := GetUserID(c)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "no user"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"user_id": uid.String()})
	})

	c.Request = httptest.NewRequest("GET", "/test", nil)
	c.Request.Header.Set("Authorization", "Bearer "+token)
	r.ServeHTTP(w, c.Request)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthMiddleware_MissingHeader(t *testing.T) {
	w := httptest.NewRecorder()
	_, r := gin.CreateTestContext(w)

	r.Use(AuthMiddleware(testSecret))
	r.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestAuthMiddleware_InvalidFormat(t *testing.T) {
	w := httptest.NewRecorder()
	_, r := gin.CreateTestContext(w)

	r.Use(AuthMiddleware(testSecret))
	r.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Basic abc123")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestAuthMiddleware_ExpiredToken(t *testing.T) {
	userID := uuid.New()
	token := createTestToken(userID, "test@example.com", "free", -1*time.Hour)

	w := httptest.NewRecorder()
	_, r := gin.CreateTestContext(w)

	r.Use(AuthMiddleware(testSecret))
	r.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestAuthMiddleware_WrongSecret(t *testing.T) {
	userID := uuid.New()
	// Sign with different secret.
	claims := Claims{
		UserID: userID,
		Email:  "test@example.com",
		Tier:   "free",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, _ := token.SignedString([]byte("wrong-secret"))

	w := httptest.NewRecorder()
	_, r := gin.CreateTestContext(w)

	r.Use(AuthMiddleware(testSecret))
	r.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestGetUserID_NotSet(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	uid, ok := GetUserID(c)
	if ok {
		t.Error("expected ok=false when user_id not set")
	}
	if uid != (uuid.UUID{}) {
		t.Error("expected zero UUID")
	}
}

func TestGetUserID_Set(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	expected := uuid.New()
	c.Set("user_id", expected)

	uid, ok := GetUserID(c)
	if !ok {
		t.Error("expected ok=true")
	}
	if uid != expected {
		t.Errorf("expected %s, got %s", expected, uid)
	}
}

func TestGetUserTier_NotSet(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	tier := GetUserTier(c)
	if tier != "free" {
		t.Errorf("expected free (default), got %s", tier)
	}
}

func TestGetUserTier_Set(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_tier", "pro")

	tier := GetUserTier(c)
	if tier != "pro" {
		t.Errorf("expected pro, got %s", tier)
	}
}

func TestAuthMiddleware_SetsContextValues(t *testing.T) {
	userID := uuid.New()
	token := createTestToken(userID, "admin@test.com", "team", 1*time.Hour)

	w := httptest.NewRecorder()
	_, r := gin.CreateTestContext(w)

	var gotEmail, gotTier string
	var gotUID uuid.UUID

	r.Use(AuthMiddleware(testSecret))
	r.GET("/test", func(c *gin.Context) {
		gotUID, _ = GetUserID(c)
		gotTier = GetUserTier(c)
		val, _ := c.Get("user_email")
		gotEmail, _ = val.(string)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if gotUID != userID {
		t.Errorf("expected user_id=%s, got %s", userID, gotUID)
	}
	if gotEmail != "admin@test.com" {
		t.Errorf("expected email=admin@test.com, got %s", gotEmail)
	}
	if gotTier != "team" {
		t.Errorf("expected tier=team, got %s", gotTier)
	}
}
