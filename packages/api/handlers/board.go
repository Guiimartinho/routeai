package handlers

import (
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

type BoardHandler struct {
	Config *config.Config
}

func NewBoardHandler(cfg *config.Config) *BoardHandler {
	return &BoardHandler{Config: cfg}
}

// GetBoardData handles GET /api/v1/projects/:id/board - returns parsed board data for the renderer.
func (h *BoardHandler) GetBoardData(c *gin.Context) {
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

	if project.Status == "uploaded" {
		c.JSON(http.StatusConflict, models.ErrorResponse{
			Error: "project has not been parsed yet",
			Code:  "NOT_PARSED",
		})
		return
	}

	// Fetch board data from parser service.
	boardData, err := h.fetchBoardData(projectID, project.StorageKey, project.Format)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error:   "failed to get board data",
			Details: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, boardData)
}

// GetLayers handles GET /api/v1/projects/:id/board/layers.
func (h *BoardHandler) GetLayers(c *gin.Context) {
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

	if project.Status == "uploaded" {
		c.JSON(http.StatusConflict, models.ErrorResponse{
			Error: "project has not been parsed yet",
			Code:  "NOT_PARSED",
		})
		return
	}

	boardData, err := h.fetchBoardData(projectID, project.StorageKey, project.Format)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error:   "failed to get board data",
			Details: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"project_id": projectID,
		"layers":     boardData.Layers,
		"total":      len(boardData.Layers),
	})
}

// GetNets handles GET /api/v1/projects/:id/board/nets.
func (h *BoardHandler) GetNets(c *gin.Context) {
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

	if project.Status == "uploaded" {
		c.JSON(http.StatusConflict, models.ErrorResponse{
			Error: "project has not been parsed yet",
			Code:  "NOT_PARSED",
		})
		return
	}

	boardData, err := h.fetchBoardData(projectID, project.StorageKey, project.Format)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error:   "failed to get board data",
			Details: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"project_id": projectID,
		"nets":       boardData.Nets,
		"total":      len(boardData.Nets),
	})
}

// fetchBoardData calls the parser service to get parsed board data.
func (h *BoardHandler) fetchBoardData(projectID uuid.UUID, storageKey, format string) (*models.BoardData, error) {
	url := fmt.Sprintf("%s/api/v1/parse?project_id=%s&storage_key=%s&format=%s",
		h.Config.ParserURL, projectID.String(), storageKey, format)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("parser service unavailable: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read parser response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("parser service returned %d: %s", resp.StatusCode, string(body))
	}

	var boardData models.BoardData
	if err := json.Unmarshal(body, &boardData); err != nil {
		return nil, fmt.Errorf("failed to parse board data: %w", err)
	}

	return &boardData, nil
}
