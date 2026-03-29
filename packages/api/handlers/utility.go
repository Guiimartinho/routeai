package handlers

import (
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"

	"routeai/api/models"
)

// ---------------------------------------------------------------------------
// In-memory API key store (dev convenience — not persisted).
// ---------------------------------------------------------------------------

var (
	apiKeyStore   = make(map[string]string)
	apiKeyStoreMu sync.RWMutex
)

// GetAPIKeyStore returns the current in-memory API key store (read-only copy).
// Other handlers can call this to look up keys at runtime.
func GetAPIKeyStore() map[string]string {
	apiKeyStoreMu.RLock()
	defer apiKeyStoreMu.RUnlock()
	out := make(map[string]string, len(apiKeyStore))
	for k, v := range apiKeyStore {
		out[k] = v
	}
	return out
}

// SetAPIKey handles POST /api/v1/config/set-key
// Stores an API key in memory for dev convenience (not persisted across restarts).
//
// Request body:
//
//	{ "provider": "anthropic", "key": "sk-ant-..." }
func SetAPIKey(c *gin.Context) {
	var req struct {
		Provider string `json:"provider" binding:"required"`
		Key      string `json:"key"      binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error:   "invalid request body",
			Details: "both 'provider' and 'key' fields are required",
		})
		return
	}

	apiKeyStoreMu.Lock()
	apiKeyStore[req.Provider] = req.Key
	apiKeyStoreMu.Unlock()

	c.JSON(http.StatusOK, gin.H{
		"status":   "ok",
		"provider": req.Provider,
		"message":  "API key stored in memory (will not persist across restarts)",
	})
}

// GetAPIInfo handles GET /api/v1/info
// Returns API metadata: name, version, available features, and engine list.
func GetAPIInfo(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"name":    "RouteAI API Gateway",
		"version": "0.4.0",
		"features": []string{
			"ai-placement",
			"ai-review",
			"ai-routing",
			"ai-constraints",
			"cross-probe",
			"export",
			"component-search",
			"ollama-proxy",
			"websocket",
		},
		"engines": []string{
			"kicad",
			"eagle",
		},
	})
}
