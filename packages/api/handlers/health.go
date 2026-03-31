package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// Service start time (set once at import).
// ---------------------------------------------------------------------------

var serviceStartTime = time.Now()

// ---------------------------------------------------------------------------
// Ollama base URL
// ---------------------------------------------------------------------------

// NOTE: ollamaBaseURL is resolved once at init via os.Getenv. This is a valid
// Go pattern for package-level config. An alternative is to read from
// config.Config at request time for hot-reloadability.
var ollamaBaseURL = getOllamaBaseURL()

func getOllamaBaseURL() string {
	if url := os.Getenv("OLLAMA_BASE_URL"); url != "" {
		return url
	}
	if url := os.Getenv("OLLAMA_HOST"); url != "" {
		return url
	}
	return "http://localhost:11434"
}

var ollamaHTTPClient = &http.Client{
	Timeout: 30 * time.Second,
}

// ---------------------------------------------------------------------------
// HealthHandler
// ---------------------------------------------------------------------------

type HealthHandler struct{}

func NewHealthHandler() *HealthHandler {
	return &HealthHandler{}
}

// HealthCheck handles GET /health — extended health with uptime and connectivity.
func (h *HealthHandler) HealthCheck(c *gin.Context) {
	uptime := time.Since(serviceStartTime)

	// Check Ollama connectivity.
	ollamaStatus := "unknown"
	ollamaVersion := ""
	ollamaResp, err := ollamaHTTPClient.Get(ollamaBaseURL + "/api/version")
	if err == nil {
		defer ollamaResp.Body.Close()
		if ollamaResp.StatusCode == http.StatusOK {
			ollamaStatus = "connected"
			var v map[string]interface{}
			if body, err := io.ReadAll(ollamaResp.Body); err == nil {
				if json.Unmarshal(body, &v) == nil {
					if ver, ok := v["version"].(string); ok {
						ollamaVersion = ver
					}
				}
			}
		} else {
			ollamaStatus = fmt.Sprintf("unhealthy (HTTP %d)", ollamaResp.StatusCode)
		}
	} else {
		ollamaStatus = "unreachable"
	}

	// Check ML service connectivity.
	mlStatus := "unknown"
	mlResp, err := mlHTTPClient.Get(mlServiceURL + "/health")
	if err == nil {
		defer mlResp.Body.Close()
		if mlResp.StatusCode == http.StatusOK {
			mlStatus = "connected"
		} else {
			mlStatus = fmt.Sprintf("unhealthy (HTTP %d)", mlResp.StatusCode)
		}
	} else {
		mlStatus = "unreachable"
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"service": "routeai-api",
		"version": "0.4.0",
		"time":    time.Now().UTC().Format(time.RFC3339),
		"uptime":  uptime.String(),
		"dependencies": gin.H{
			"ollama": gin.H{
				"status":  ollamaStatus,
				"url":     ollamaBaseURL,
				"version": ollamaVersion,
			},
			"ml_service": gin.H{
				"status": mlStatus,
				"url":    mlServiceURL,
			},
		},
	})
}

// OllamaStatus handles GET /api/v1/ollama/status — proxy to Ollama version/status.
func (h *HealthHandler) OllamaStatus(c *gin.Context) {
	resp, err := ollamaHTTPClient.Get(ollamaBaseURL + "/api/version")
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error":   "Ollama unreachable",
			"url":     ollamaBaseURL,
			"details": err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	var data map[string]interface{}
	if json.Unmarshal(body, &data) == nil {
		data["status"] = "connected"
		data["url"] = ollamaBaseURL
		c.JSON(http.StatusOK, data)
	} else {
		c.Data(resp.StatusCode, "application/json", body)
	}
}

// OllamaConfig handles GET /api/ollama/config — GPU info and model config.
// Proxies to the ML service /ml/gpu-info endpoint; returns sensible defaults
// if the ML service is unreachable.
func (h *HealthHandler) OllamaConfig(c *gin.Context) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(mlServiceURL + "/ml/gpu-info")
	if err != nil {
		// Fallback: return defaults for 12GB GPU.
		c.JSON(http.StatusOK, gin.H{
			"gpu": gin.H{
				"name":          "Unknown",
				"vram_total_mb": 12288,
				"vram_free_mb":  10240,
			},
			"profile": gin.H{
				"vram_gb":        12,
				"resident_model": "qwen2.5:7b",
				"swap_model":     "qwen2.5-coder:14b",
				"max_context":    4096,
				"max_parallel":   2,
			},
			"tiers": gin.H{
				"t3_fast":       "qwen2.5:7b",
				"t2_structured": "qwen2.5-coder:14b",
				"t1_strategy":   "decompose",
			},
		})
		return
	}
	defer resp.Body.Close()

	// Forward ML service response as-is.
	body, _ := io.ReadAll(resp.Body)
	c.Data(resp.StatusCode, "application/json", body)
}

// OllamaModels handles GET /api/v1/ollama/models — list available models.
func (h *HealthHandler) OllamaModels(c *gin.Context) {
	resp, err := ollamaHTTPClient.Get(ollamaBaseURL + "/api/tags")
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error":   "Ollama unreachable",
			"details": err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	c.Data(resp.StatusCode, "application/json", body)
}

// OllamaChat handles POST /api/ollama/chat — proxy chat request to Ollama.
// Supports both streaming and non-streaming modes.
func (h *HealthHandler) OllamaChat(c *gin.Context) {
	rawBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	req, err := http.NewRequest("POST", ollamaBaseURL+"/api/chat", bytes.NewReader(rawBody))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create request"})
		return
	}
	req.Header.Set("Content-Type", "application/json")

	// Check if streaming is requested.
	var body map[string]interface{}
	isStream := false
	if json.Unmarshal(rawBody, &body) == nil {
		if s, ok := body["stream"].(bool); ok {
			isStream = s
		}
	}

	chatClient := &http.Client{Timeout: 5 * time.Minute}
	resp, err := chatClient.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error":   "Ollama unreachable",
			"details": err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	if isStream {
		// Stream response back to caller.
		c.Status(resp.StatusCode)
		c.Header("Content-Type", "application/x-ndjson")
		c.Stream(func(w io.Writer) bool {
			buf := make([]byte, 4096)
			n, readErr := resp.Body.Read(buf)
			if n > 0 {
				w.Write(buf[:n])
			}
			return readErr == nil
		})
	} else {
		// Non-streaming: read full response and forward.
		respBody, _ := io.ReadAll(resp.Body)
		c.Data(resp.StatusCode, "application/json", respBody)
	}
}

// OllamaPull handles POST /api/v1/ollama/pull — proxy pull request to Ollama.
func (h *HealthHandler) OllamaPull(c *gin.Context) {
	rawBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	req, err := http.NewRequest("POST", ollamaBaseURL+"/api/pull", bytes.NewReader(rawBody))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create request"})
		return
	}
	req.Header.Set("Content-Type", "application/json")

	// Use a longer timeout for pulls (models can be large).
	pullClient := &http.Client{Timeout: 30 * time.Minute}
	resp, err := pullClient.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error":   "Ollama unreachable",
			"details": err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Stream response back to caller.
	c.Status(resp.StatusCode)
	c.Header("Content-Type", "application/x-ndjson")
	c.Stream(func(w io.Writer) bool {
		buf := make([]byte, 4096)
		n, err := resp.Body.Read(buf)
		if n > 0 {
			w.Write(buf[:n])
		}
		return err == nil
	})
}
