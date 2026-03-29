package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"routeai/api/config"
)

func TestRateLimiter_AllowWithinLimit(t *testing.T) {
	cfg := config.RateLimitConfig{
		FreeReviewsPerMonth: 3,
		ProReviewsPerMonth:  0,
		TeamReviewsPerMonth: 0,
	}

	rl := newRateLimiter(cfg)
	userID := uuid.New()

	for i := 0; i < 3; i++ {
		allowed, remaining, _ := rl.allow(userID, "free")
		if !allowed {
			t.Errorf("request %d should be allowed", i+1)
		}
		expectedRemaining := 3 - (i + 1)
		if remaining != expectedRemaining {
			t.Errorf("request %d: expected remaining=%d, got %d", i+1, expectedRemaining, remaining)
		}
	}
}

func TestRateLimiter_DenyWhenExceeded(t *testing.T) {
	cfg := config.RateLimitConfig{
		FreeReviewsPerMonth: 2,
		ProReviewsPerMonth:  0,
		TeamReviewsPerMonth: 0,
	}

	rl := newRateLimiter(cfg)
	userID := uuid.New()

	// Use up the limit.
	rl.allow(userID, "free")
	rl.allow(userID, "free")

	// Third request should be denied.
	allowed, remaining, _ := rl.allow(userID, "free")
	if allowed {
		t.Error("expected request to be denied")
	}
	if remaining != 0 {
		t.Errorf("expected remaining=0, got %d", remaining)
	}
}

func TestRateLimiter_UnlimitedForPro(t *testing.T) {
	cfg := config.RateLimitConfig{
		FreeReviewsPerMonth: 5,
		ProReviewsPerMonth:  0, // 0 = unlimited
		TeamReviewsPerMonth: 0,
	}

	rl := newRateLimiter(cfg)
	userID := uuid.New()

	for i := 0; i < 100; i++ {
		allowed, _, _ := rl.allow(userID, "pro")
		if !allowed {
			t.Errorf("pro user should have unlimited access, denied at request %d", i+1)
		}
	}
}

func TestRateLimiter_DifferentUsersIndependent(t *testing.T) {
	cfg := config.RateLimitConfig{
		FreeReviewsPerMonth: 1,
		ProReviewsPerMonth:  0,
		TeamReviewsPerMonth: 0,
	}

	rl := newRateLimiter(cfg)
	user1 := uuid.New()
	user2 := uuid.New()

	// User 1 uses their limit.
	rl.allow(user1, "free")
	allowed1, _, _ := rl.allow(user1, "free")
	if allowed1 {
		t.Error("user1 should be denied")
	}

	// User 2 should still be allowed.
	allowed2, _, _ := rl.allow(user2, "free")
	if !allowed2 {
		t.Error("user2 should be allowed (independent limit)")
	}
}

func TestRateLimiter_LimitForTier(t *testing.T) {
	cfg := config.RateLimitConfig{
		FreeReviewsPerMonth: 5,
		ProReviewsPerMonth:  50,
		TeamReviewsPerMonth: 100,
	}

	rl := newRateLimiter(cfg)

	tests := []struct {
		tier     string
		expected int
	}{
		{"free", 5},
		{"pro", 50},
		{"team", 100},
		{"unknown", 5}, // defaults to free
	}

	for _, tt := range tests {
		got := rl.limitForTier(tt.tier)
		if got != tt.expected {
			t.Errorf("limitForTier(%s) = %d, want %d", tt.tier, got, tt.expected)
		}
	}
}

func TestRateLimitMiddleware_SkipsNonPOST(t *testing.T) {
	cfg := config.RateLimitConfig{FreeReviewsPerMonth: 0} // Would block POST.
	w := httptest.NewRecorder()
	_, r := gin.CreateTestContext(w)

	r.Use(func(c *gin.Context) {
		c.Set("user_id", uuid.New())
		c.Set("user_tier", "free")
		c.Next()
	})
	r.Use(RateLimitMiddleware(cfg))
	r.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("GET should bypass rate limit, got %d", w.Code)
	}
}

func TestRateLimitMiddleware_BlocksPOSTWhenExceeded(t *testing.T) {
	cfg := config.RateLimitConfig{
		FreeReviewsPerMonth: 1,
		ProReviewsPerMonth:  0,
		TeamReviewsPerMonth: 0,
	}

	userID := uuid.New()

	makeRequest := func() int {
		w := httptest.NewRecorder()
		_, r := gin.CreateTestContext(w)

		r.Use(func(c *gin.Context) {
			c.Set("user_id", userID)
			c.Set("user_tier", "free")
			c.Next()
		})
		r.Use(RateLimitMiddleware(cfg))
		r.POST("/review", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"ok": true})
		})

		req := httptest.NewRequest("POST", "/review", nil)
		r.ServeHTTP(w, req)
		return w.Code
	}

	// First request should succeed.
	code1 := makeRequest()
	if code1 != http.StatusOK {
		t.Errorf("first request should succeed, got %d", code1)
	}

	// Second request should be rate limited.
	code2 := makeRequest()
	if code2 != http.StatusTooManyRequests {
		t.Errorf("second request should be 429, got %d", code2)
	}
}

func TestRateLimiter_Cleanup(t *testing.T) {
	cfg := config.RateLimitConfig{FreeReviewsPerMonth: 5}
	rl := newRateLimiter(cfg)

	userID := uuid.New()
	rl.allow(userID, "free")

	// Verify user exists.
	rl.mu.RLock()
	_, exists := rl.users[userID]
	rl.mu.RUnlock()
	if !exists {
		t.Error("user should exist after allow()")
	}

	// Manually expire the entry by setting reset time to past.
	rl.mu.Lock()
	rl.users[userID].ResetTime = rl.users[userID].ResetTime.AddDate(-1, 0, 0)
	rl.mu.Unlock()

	rl.cleanup()

	rl.mu.RLock()
	_, exists = rl.users[userID]
	rl.mu.RUnlock()
	if exists {
		t.Error("expired user should be cleaned up")
	}
}
