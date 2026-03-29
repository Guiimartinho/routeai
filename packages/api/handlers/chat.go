package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"routeai/api/config"
	"routeai/api/db"
	"routeai/api/middleware"
	"routeai/api/models"
)

// mlChatClient is an HTTP client with a 60-second timeout for chat requests,
// which can be slow due to LLM inference.
var mlChatClient = &http.Client{
	Timeout: 60 * time.Second,
}

type ChatHandler struct {
	Config *config.Config
	WSHub  *Hub
}

func NewChatHandler(cfg *config.Config, hub *Hub) *ChatHandler {
	return &ChatHandler{Config: cfg, WSHub: hub}
}

// SendMessage handles POST /api/v1/projects/:id/chat - sends a message and gets an AI response.
func (h *ChatHandler) SendMessage(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	projectID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid project ID"})
		return
	}

	// Verify project ownership.
	project, err := db.GetProjectByID(projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "project not found"})
		return
	}
	if project.UserID != userID {
		c.JSON(http.StatusForbidden, models.ErrorResponse{Error: "access denied"})
		return
	}

	var req models.ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error:   "invalid request body",
			Details: err.Error(),
		})
		return
	}

	// Store the user message.
	userMsg := &models.ChatMessage{
		ProjectID: projectID,
		UserID:    userID,
		Role:      "user",
		Content:   req.Message,
	}
	if err := db.CreateChatMessage(userMsg); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error:   "failed to store message",
			Details: err.Error(),
		})
		return
	}

	// Get chat history for context.
	history, err := db.ListChatMessages(projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "failed to get chat history"})
		return
	}

	// Build context for the intelligence service.
	chatHistory := make([]map[string]string, 0, len(history))
	for _, msg := range history {
		chatHistory = append(chatHistory, map[string]string{
			"role":    msg.Role,
			"content": msg.Content,
		})
	}

	reqBody, _ := json.Marshal(map[string]interface{}{
		"project_id":  projectID.String(),
		"storage_key": project.StorageKey,
		"format":      project.Format,
		"message":     req.Message,
		"history":     chatHistory,
	})

	// Call the ML service with a timeout-configured client.
	resp, err := mlChatClient.Post(
		fmt.Sprintf("%s/ml/chat", h.Config.MLServiceURL),
		"application/json",
		bytes.NewReader(reqBody),
	)

	var aiReply string
	if err != nil {
		// If intelligence service is unavailable, return a fallback.
		aiReply = "I apologize, but I'm currently unable to process your request. The AI service is temporarily unavailable. Please try again in a moment."
	} else {
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)

		if resp.StatusCode == http.StatusOK {
			var result struct {
				Reply string `json:"reply"`
			}
			if err := json.Unmarshal(body, &result); err == nil {
				aiReply = result.Reply
			} else {
				aiReply = "I encountered an error processing the response. Please try again."
			}
		} else {
			aiReply = "I encountered an error while analyzing your project. Please try again."
		}
	}

	// Store the assistant message.
	assistantMsg := &models.ChatMessage{
		ProjectID: projectID,
		UserID:    userID,
		Role:      "assistant",
		Content:   aiReply,
	}
	if err := db.CreateChatMessage(assistantMsg); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: "failed to store response",
		})
		return
	}

	// Notify via WebSocket for streaming (the full reply in this case).
	h.WSHub.SendToUser(userID, WSMessage{
		Type: "chat_reply",
		Payload: map[string]interface{}{
			"project_id": projectID,
			"message":    assistantMsg,
		},
	})

	// Record usage.
	usageRec := &models.UsageRecord{
		UserID:    userID,
		Action:    "chat",
		ProjectID: &projectID,
	}
	_ = db.CreateUsageRecord(usageRec)

	c.JSON(http.StatusOK, models.ChatResponse{
		Reply: *assistantMsg,
	})
}

// GetHistory handles GET /api/v1/projects/:id/chat - returns the chat history.
func (h *ChatHandler) GetHistory(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	projectID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid project ID"})
		return
	}

	project, err := db.GetProjectByID(projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "project not found"})
		return
	}
	if project.UserID != userID {
		c.JSON(http.StatusForbidden, models.ErrorResponse{Error: "access denied"})
		return
	}

	messages, err := db.ListChatMessages(projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error:   "failed to get chat history",
			Details: err.Error(),
		})
		return
	}

	if messages == nil {
		messages = []models.ChatMessage{}
	}

	c.JSON(http.StatusOK, gin.H{
		"project_id": projectID,
		"messages":   messages,
		"total":      len(messages),
	})
}
