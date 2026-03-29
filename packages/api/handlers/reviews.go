package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"routeai/api/config"
	"routeai/api/db"
	"routeai/api/middleware"
	"routeai/api/models"
)

// mlReviewClient is an HTTP client with a 120-second timeout for review requests,
// which can take longer due to full design analysis.
var mlReviewClient = &http.Client{
	Timeout: 120 * time.Second,
}

type ReviewHandler struct {
	Config *config.Config
	WSHub  *Hub
}

func NewReviewHandler(cfg *config.Config, hub *Hub) *ReviewHandler {
	return &ReviewHandler{Config: cfg, WSHub: hub}
}

// StartReview handles POST /api/v1/projects/:id/review - dispatches an async AI review.
func (h *ReviewHandler) StartReview(c *gin.Context) {
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

	// Verify project exists and belongs to user.
	project, err := db.GetProjectByID(projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "project not found"})
		return
	}
	if project.UserID != userID {
		c.JSON(http.StatusForbidden, models.ErrorResponse{Error: "access denied"})
		return
	}

	// Check if there's already a running review.
	existing, err := db.GetReviewByProjectID(projectID)
	if err == nil && (existing.Status == "pending" || existing.Status == "running") {
		c.JSON(http.StatusConflict, models.ErrorResponse{
			Error: "a review is already in progress",
			Code:  "REVIEW_IN_PROGRESS",
		})
		return
	}

	// Create the review record.
	review := &models.Review{
		ProjectID: projectID,
		UserID:    userID,
		Status:    "pending",
	}
	if err := db.CreateReview(review); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error:   "failed to create review",
			Details: err.Error(),
		})
		return
	}

	// Record usage.
	usageRec := &models.UsageRecord{
		UserID:    userID,
		Action:    "review",
		ProjectID: &projectID,
	}
	_ = db.CreateUsageRecord(usageRec)

	// Update project status.
	_ = db.UpdateProjectStatus(projectID, "reviewing")

	// Dispatch async review job to intelligence service.
	go h.dispatchReview(review, project)

	c.JSON(http.StatusAccepted, review)
}

// GetReview handles GET /api/v1/projects/:id/review - returns the latest review.
func (h *ReviewHandler) GetReview(c *gin.Context) {
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

	review, err := db.GetReviewByProjectID(projectID)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "no review found for this project"})
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "failed to get review"})
		return
	}

	c.JSON(http.StatusOK, review)
}

// GetReviewItems handles GET /api/v1/projects/:id/review/items with filters.
func (h *ReviewHandler) GetReviewItems(c *gin.Context) {
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

	review, err := db.GetReviewByProjectID(projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "no review found"})
		return
	}

	category := c.Query("category")
	severity := c.Query("severity")

	items, err := db.ListReviewItems(review.ID, category, severity)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error:   "failed to list review items",
			Details: err.Error(),
		})
		return
	}

	if items == nil {
		items = []models.ReviewItem{}
	}

	c.JSON(http.StatusOK, gin.H{
		"review_id": review.ID,
		"items":     items,
		"total":     len(items),
		"filters": gin.H{
			"category": category,
			"severity": severity,
		},
	})
}

// dispatchReview sends the review request to the intelligence service asynchronously.
func (h *ReviewHandler) dispatchReview(review *models.Review, project *models.Project) {
	now := time.Now()
	review.StartedAt = &now
	review.Status = "running"
	_ = db.UpdateReview(review)

	// Notify via WebSocket.
	h.WSHub.SendToUser(review.UserID, WSMessage{
		Type: "review_progress",
		Payload: map[string]interface{}{
			"review_id":  review.ID,
			"project_id": review.ProjectID,
			"status":     "running",
			"progress":   0,
		},
	})

	// Call ML service.
	reqBody, _ := json.Marshal(map[string]interface{}{
		"project_id":  project.ID.String(),
		"storage_key": project.StorageKey,
		"format":      project.Format,
	})

	resp, err := mlReviewClient.Post(
		fmt.Sprintf("%s/ml/review", h.Config.MLServiceURL),
		"application/json",
		bytes.NewReader(reqBody),
	)

	if err != nil {
		log.Printf("Failed to dispatch review to intelligence service: %v", err)
		completedAt := time.Now()
		review.Status = "failed"
		review.ErrorMsg = fmt.Sprintf("intelligence service unavailable: %v", err)
		review.CompletedAt = &completedAt
		_ = db.UpdateReview(review)
		_ = db.UpdateProjectStatus(project.ID, "error")

		h.WSHub.SendToUser(review.UserID, WSMessage{
			Type: "review_progress",
			Payload: map[string]interface{}{
				"review_id":  review.ID,
				"project_id": review.ProjectID,
				"status":     "failed",
				"error":      review.ErrorMsg,
			},
		})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		completedAt := time.Now()
		review.Status = "failed"
		review.ErrorMsg = fmt.Sprintf("intelligence service returned %d: %s", resp.StatusCode, string(body))
		review.CompletedAt = &completedAt
		_ = db.UpdateReview(review)
		_ = db.UpdateProjectStatus(project.ID, "error")

		h.WSHub.SendToUser(review.UserID, WSMessage{
			Type: "review_progress",
			Payload: map[string]interface{}{
				"review_id":  review.ID,
				"project_id": review.ProjectID,
				"status":     "failed",
				"error":      review.ErrorMsg,
			},
		})
		return
	}

	// Parse intelligence service response.
	var result struct {
		Summary string  `json:"summary"`
		Score   float64 `json:"score"`
		Items   []struct {
			Category   string `json:"category"`
			Severity   string `json:"severity"`
			Title      string `json:"title"`
			Message    string `json:"message"`
			Location   string `json:"location"`
			Suggestion string `json:"suggestion"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		completedAt := time.Now()
		review.Status = "failed"
		review.ErrorMsg = fmt.Sprintf("failed to parse review result: %v", err)
		review.CompletedAt = &completedAt
		_ = db.UpdateReview(review)
		_ = db.UpdateProjectStatus(project.ID, "error")
		return
	}

	// Store review items.
	for _, item := range result.Items {
		ri := &models.ReviewItem{
			ReviewID:   review.ID,
			Category:   item.Category,
			Severity:   item.Severity,
			Title:      item.Title,
			Message:    item.Message,
			Location:   item.Location,
			Suggestion: item.Suggestion,
		}
		_ = db.CreateReviewItem(ri)
	}

	// Update the review.
	completedAt := time.Now()
	review.Status = "completed"
	review.Summary = result.Summary
	review.Score = &result.Score
	review.ItemCount = len(result.Items)
	review.CompletedAt = &completedAt
	_ = db.UpdateReview(review)
	_ = db.UpdateProjectStatus(project.ID, "reviewed")

	// Notify completion via WebSocket.
	h.WSHub.SendToUser(review.UserID, WSMessage{
		Type: "review_progress",
		Payload: map[string]interface{}{
			"review_id":  review.ID,
			"project_id": review.ProjectID,
			"status":     "completed",
			"progress":   100,
			"summary":    result.Summary,
			"score":      result.Score,
			"item_count": len(result.Items),
		},
	})
}
