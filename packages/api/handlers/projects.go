package handlers

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"routeai/api/config"
	"routeai/api/db"
	"routeai/api/middleware"
	"routeai/api/models"
	"routeai/api/storage"
)

type ProjectHandler struct {
	Config *config.Config
}

func NewProjectHandler(cfg *config.Config) *ProjectHandler {
	return &ProjectHandler{Config: cfg}
}

// CreateProject handles POST /api/v1/projects - upload a project zip file.
func (h *ProjectHandler) CreateProject(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error:   "file is required",
			Details: err.Error(),
		})
		return
	}
	defer file.Close()

	name := c.PostForm("name")
	if name == "" {
		name = strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))
	}
	description := c.PostForm("description")

	// Read file into memory to validate it.
	buf := &bytes.Buffer{}
	size, err := io.Copy(buf, file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "failed to read file"})
		return
	}

	// Validate that it's a zip file.
	_, err = zip.NewReader(bytes.NewReader(buf.Bytes()), size)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error:   "invalid file format",
			Details: "file must be a valid zip archive",
		})
		return
	}

	// Detect EDA format from zip contents.
	format := detectFormat(buf.Bytes(), size)

	// Upload to MinIO.
	projectID := uuid.New()
	storageKey := fmt.Sprintf("projects/%s/%s/%s", userID.String(), projectID.String(), header.Filename)

	_, err = storage.UploadFile(
		h.Config.MinIO.Bucket,
		storageKey,
		bytes.NewReader(buf.Bytes()),
		size,
		"application/zip",
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error:   "failed to store file",
			Details: err.Error(),
		})
		return
	}

	// Create database record.
	project := &models.Project{
		ID:          projectID,
		UserID:      userID,
		Name:        name,
		Description: description,
		Status:      "uploaded",
		Format:      format,
		StorageKey:  storageKey,
		FileSize:    size,
	}

	if err := db.CreateProject(project); err != nil {
		// Clean up uploaded file on DB failure.
		_ = storage.DeleteFile(h.Config.MinIO.Bucket, storageKey)
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error:   "failed to create project record",
			Details: err.Error(),
		})
		return
	}

	// Record usage.
	usageRec := &models.UsageRecord{
		UserID:    userID,
		Action:    "upload",
		ProjectID: &project.ID,
	}
	_ = db.CreateUsageRecord(usageRec)

	c.JSON(http.StatusCreated, project)
}

// GetProject handles GET /api/v1/projects/:id.
func (h *ProjectHandler) GetProject(c *gin.Context) {
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

	// Ensure the user owns this project.
	if project.UserID != userID {
		c.JSON(http.StatusForbidden, models.ErrorResponse{Error: "access denied"})
		return
	}

	c.JSON(http.StatusOK, project)
}

// ListProjects handles GET /api/v1/projects with pagination.
func (h *ProjectHandler) ListProjects(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "20"))

	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}

	projects, total, err := db.ListProjectsByUser(userID, page, perPage)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error:   "failed to list projects",
			Details: err.Error(),
		})
		return
	}

	if projects == nil {
		projects = []models.Project{}
	}

	totalPages := (total + perPage - 1) / perPage

	c.JSON(http.StatusOK, models.PaginatedResponse{
		Data:       projects,
		Total:      total,
		Page:       page,
		PerPage:    perPage,
		TotalPages: totalPages,
	})
}

// DeleteProject handles DELETE /api/v1/projects/:id.
func (h *ProjectHandler) DeleteProject(c *gin.Context) {
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

	// Delete from storage.
	if project.StorageKey != "" {
		_ = storage.DeleteFile(h.Config.MinIO.Bucket, project.StorageKey)
	}

	// Delete from database (cascades to files, reviews, chat messages).
	if err := db.DeleteProject(projectID); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error:   "failed to delete project",
			Details: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "project deleted"})
}

// detectFormat examines zip contents to determine the EDA format.
func detectFormat(data []byte, size int64) string {
	reader, err := zip.NewReader(bytes.NewReader(data), size)
	if err != nil {
		return "unknown"
	}

	for _, f := range reader.File {
		name := strings.ToLower(f.Name)
		switch {
		case strings.HasSuffix(name, ".kicad_pcb") || strings.HasSuffix(name, ".kicad_sch"):
			return "kicad"
		case strings.HasSuffix(name, ".brd") || strings.HasSuffix(name, ".sch"):
			// Could be Eagle or other formats; check for Eagle XML markers.
			return "eagle"
		case strings.HasSuffix(name, ".pcbdoc") || strings.HasSuffix(name, ".schdoc"):
			return "altium"
		case strings.HasSuffix(name, ".gbr") || strings.HasSuffix(name, ".gtl") ||
			strings.HasSuffix(name, ".gbl") || strings.HasSuffix(name, ".gts") ||
			strings.HasSuffix(name, ".gbs"):
			return "gerber"
		}
	}

	return "unknown"
}
