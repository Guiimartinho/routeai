package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"routeai/api/config"
)

type userUsage struct {
	Count     int
	ResetTime time.Time
}

type rateLimiter struct {
	mu     sync.RWMutex
	users  map[uuid.UUID]*userUsage
	config config.RateLimitConfig
}

func newRateLimiter(cfg config.RateLimitConfig) *rateLimiter {
	rl := &rateLimiter{
		users:  make(map[uuid.UUID]*userUsage),
		config: cfg,
	}
	// Periodic cleanup of expired entries.
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			rl.cleanup()
		}
	}()
	return rl
}

func (rl *rateLimiter) cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	for uid, usage := range rl.users {
		if now.After(usage.ResetTime) {
			delete(rl.users, uid)
		}
	}
}

func (rl *rateLimiter) allow(userID uuid.UUID, tier string) (bool, int, time.Time) {
	limit := rl.limitForTier(tier)
	if limit == 0 {
		// 0 means unlimited.
		return true, 0, time.Time{}
	}

	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	usage, exists := rl.users[userID]
	if !exists || now.After(usage.ResetTime) {
		// Start of new billing period (first of next month).
		resetTime := time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC)
		rl.users[userID] = &userUsage{
			Count:     1,
			ResetTime: resetTime,
		}
		return true, limit - 1, resetTime
	}

	if usage.Count >= limit {
		return false, 0, usage.ResetTime
	}

	usage.Count++
	remaining := limit - usage.Count
	return true, remaining, usage.ResetTime
}

func (rl *rateLimiter) limitForTier(tier string) int {
	switch tier {
	case "free":
		return rl.config.FreeReviewsPerMonth
	case "pro":
		return rl.config.ProReviewsPerMonth
	case "team":
		return rl.config.TeamReviewsPerMonth
	default:
		return rl.config.FreeReviewsPerMonth
	}
}

// RateLimitMiddleware enforces per-user monthly review limits based on tier.
// It only rate-limits POST requests to review endpoints.
func RateLimitMiddleware(cfg config.RateLimitConfig) gin.HandlerFunc {
	rl := newRateLimiter(cfg)

	return func(c *gin.Context) {
		// Only rate-limit review creation.
		if c.Request.Method != http.MethodPost {
			c.Next()
			return
		}

		val, exists := c.Get("user_id")
		if !exists {
			c.Next()
			return
		}
		userID, ok := val.(uuid.UUID)
		if !ok {
			c.Next()
			return
		}

		tier := GetUserTier(c)

		allowed, remaining, resetTime := rl.allow(userID, tier)
		if !allowed {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":      "monthly review limit exceeded",
				"tier":       tier,
				"reset_time": resetTime.Format(time.RFC3339),
				"upgrade":    "Upgrade to Pro for unlimited reviews",
			})
			return
		}

		c.Header("X-RateLimit-Remaining", strconv.Itoa(remaining))
		c.Next()
	}
}
