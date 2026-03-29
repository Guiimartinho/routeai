package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"routeai/api/config"
	"routeai/api/db"
	"routeai/api/middleware"
	"routeai/api/models"
)

// ---------------------------------------------------------------------------
// Python ML service proxy
// ---------------------------------------------------------------------------

// NOTE: mlServiceURL is resolved once at init via os.Getenv. This is a valid
// Go pattern for package-level config. An alternative is to read from
// config.Config at request time for hot-reloadability.
var mlServiceURL = getMLServiceURL()

func getMLServiceURL() string {
	if url := os.Getenv("ML_SERVICE_URL"); url != "" {
		return url
	}
	return "http://localhost:8001"
}

var mlHTTPClient = &http.Client{
	Timeout: 120 * time.Second,
}

// proxyToML forwards a request body to the Python ML service and streams the
// response back to the caller.  Returns (statusCode, responseBody, error).
func proxyToML(method, path string, body io.Reader) (int, []byte, error) {
	url := mlServiceURL + path

	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return 0, nil, fmt.Errorf("failed to create ML request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := mlHTTPClient.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("ML service unreachable at %s: %w", url, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, fmt.Errorf("failed to read ML response: %w", err)
	}

	return resp.StatusCode, respBody, nil
}

// ---------------------------------------------------------------------------
// WorkflowHandler — orchestrates AI workflows, proxying ML calls to Python.
// ---------------------------------------------------------------------------

type WorkflowHandler struct {
	Config *config.Config
}

func NewWorkflowHandler(cfg *config.Config) *WorkflowHandler {
	return &WorkflowHandler{Config: cfg}
}

// AIPlacement handles POST /api/v1/workflow/:id/ai-placement
// Sends board data to the Python ML service for AI-driven placement analysis.
func (h *WorkflowHandler) AIPlacement(c *gin.Context) {
	_, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	workflowID := c.Param("id")
	if _, err := uuid.Parse(workflowID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid workflow ID"})
		return
	}

	// Read request body (board data + placement params).
	rawBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid request body"})
		return
	}

	// Wrap with workflow ID for the ML service.
	payload := map[string]interface{}{
		"workflow_id": workflowID,
	}
	// Merge caller's body into the payload.
	var callerData map[string]interface{}
	if len(rawBody) > 0 {
		if err := json.Unmarshal(rawBody, &callerData); err == nil {
			for k, v := range callerData {
				payload[k] = v
			}
		}
	}

	payloadBytes, _ := json.Marshal(payload)
	status, respBody, err := proxyToML("POST", "/ml/placement", bytes.NewReader(payloadBytes))
	if err != nil {
		log.Printf("ML placement proxy error: %v", err)
		c.JSON(http.StatusBadGateway, models.ErrorResponse{
			Error:   "ML service unavailable",
			Details: err.Error(),
		})
		return
	}

	c.Data(status, "application/json", respBody)
}

// AIReview handles POST /api/v1/workflow/:id/ai-review
// Sends board data to the Python ML service for AI design review.
func (h *WorkflowHandler) AIReview(c *gin.Context) {
	_, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	workflowID := c.Param("id")
	if _, err := uuid.Parse(workflowID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid workflow ID"})
		return
	}

	rawBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid request body"})
		return
	}

	payload := map[string]interface{}{
		"workflow_id": workflowID,
	}
	var callerData map[string]interface{}
	if len(rawBody) > 0 {
		if err := json.Unmarshal(rawBody, &callerData); err == nil {
			for k, v := range callerData {
				payload[k] = v
			}
		}
	}

	payloadBytes, _ := json.Marshal(payload)
	status, respBody, err := proxyToML("POST", "/ml/review", bytes.NewReader(payloadBytes))
	if err != nil {
		log.Printf("ML review proxy error: %v", err)
		c.JSON(http.StatusBadGateway, models.ErrorResponse{
			Error:   "ML service unavailable",
			Details: err.Error(),
		})
		return
	}

	c.Data(status, "application/json", respBody)
}

// AIRouting handles POST /api/v1/workflow/:id/ai-routing
// Sends board data to the Python ML service for AI-driven routing strategy.
func (h *WorkflowHandler) AIRouting(c *gin.Context) {
	_, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	workflowID := c.Param("id")
	if _, err := uuid.Parse(workflowID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid workflow ID"})
		return
	}

	rawBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid request body"})
		return
	}

	payload := map[string]interface{}{
		"workflow_id": workflowID,
	}
	var callerData map[string]interface{}
	if len(rawBody) > 0 {
		if err := json.Unmarshal(rawBody, &callerData); err == nil {
			for k, v := range callerData {
				payload[k] = v
			}
		}
	}

	payloadBytes, _ := json.Marshal(payload)
	status, respBody, err := proxyToML("POST", "/ml/routing-strategy", bytes.NewReader(payloadBytes))
	if err != nil {
		log.Printf("ML routing-strategy proxy error: %v", err)
		c.JSON(http.StatusBadGateway, models.ErrorResponse{
			Error:   "ML service unavailable",
			Details: err.Error(),
		})
		return
	}

	c.Data(status, "application/json", respBody)
}

// GenerateConstraints handles POST /api/v1/projects/:id/ai/constraints
// Sends project data to the Python ML service to generate design constraints.
func (h *WorkflowHandler) GenerateConstraints(c *gin.Context) {
	_, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	projectID := c.Param("id")
	if _, err := uuid.Parse(projectID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid project ID"})
		return
	}

	rawBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid request body"})
		return
	}

	payload := map[string]interface{}{
		"project_id": projectID,
	}
	var callerData map[string]interface{}
	if len(rawBody) > 0 {
		if err := json.Unmarshal(rawBody, &callerData); err == nil {
			for k, v := range callerData {
				payload[k] = v
			}
		}
	}

	payloadBytes, _ := json.Marshal(payload)
	status, respBody, err := proxyToML("POST", "/ml/constraints", bytes.NewReader(payloadBytes))
	if err != nil {
		log.Printf("ML constraints proxy error: %v", err)
		c.JSON(http.StatusBadGateway, models.ErrorResponse{
			Error:   "ML service unavailable",
			Details: err.Error(),
		})
		return
	}

	c.Data(status, "application/json", respBody)
}

// SuggestComponents handles POST /api/v1/ml/suggest
// Proxies to the Python ML service for AI component suggestions.
func (h *WorkflowHandler) SuggestComponents(c *gin.Context) {
	_, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	rawBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid request body"})
		return
	}

	status, respBody, err := proxyToML("POST", "/ml/suggest", bytes.NewReader(rawBody))
	if err != nil {
		log.Printf("ML suggest proxy error: %v", err)
		c.JSON(http.StatusBadGateway, models.ErrorResponse{
			Error:   "ML service unavailable",
			Details: err.Error(),
		})
		return
	}

	c.Data(status, "application/json", respBody)
}

// RAGQuery handles POST /api/v1/ml/rag-query
// Proxies to the Python ML service for RAG datasheet queries.
func (h *WorkflowHandler) RAGQuery(c *gin.Context) {
	_, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	rawBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid request body"})
		return
	}

	status, respBody, err := proxyToML("POST", "/ml/rag/query", bytes.NewReader(rawBody))
	if err != nil {
		log.Printf("ML RAG query proxy error: %v", err)
		c.JSON(http.StatusBadGateway, models.ErrorResponse{
			Error:   "ML service unavailable",
			Details: err.Error(),
		})
		return
	}

	c.Data(status, "application/json", respBody)
}

// ---------------------------------------------------------------------------
// GetStatus — GET /api/v1/workflow/:id/status
// Queries actual project state from the database to determine workflow stage.
// Returns: "uploaded" | "parsed" | "reviewing" | "reviewed" | "routing" | "complete"
// ---------------------------------------------------------------------------
func (h *WorkflowHandler) GetStatus(c *gin.Context) {
	_, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	projectID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid workflow/project ID"})
		return
	}

	// 1. Load the project to see its current status.
	project, err := db.GetProjectByID(projectID)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "project not found"})
		} else {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse{
				Error:   "failed to query project",
				Details: err.Error(),
			})
		}
		return
	}

	// 2. Determine the workflow stage by inspecting project status and reviews.
	stage := determineWorkflowStage(project)

	// 3. Compute progress percentage based on stage.
	progress := stageProgress(stage)

	// 4. Build a human-readable message.
	message := stageMessage(stage)

	c.JSON(http.StatusOK, gin.H{
		"workflow_id":    projectID.String(),
		"status":         stage,
		"progress":       progress,
		"message":        message,
		"project_status": project.Status,
	})
}

// determineWorkflowStage maps actual DB state to a workflow stage string.
func determineWorkflowStage(project *models.Project) string {
	switch project.Status {
	case "uploaded", "parsing":
		return "uploaded"
	case "error":
		// Check if the project was parsed before the error occurred by looking
		// for a review. If a review exists, the error happened after parsing.
		review, err := db.GetReviewByProjectID(project.ID)
		if err != nil || review == nil {
			return "uploaded"
		}
		return reviewStatusToStage(review)
	case "parsed":
		// Project is parsed. Check if a review exists.
		review, err := db.GetReviewByProjectID(project.ID)
		if err != nil || review == nil {
			return "parsed"
		}
		return reviewStatusToStage(review)
	case "reviewing":
		return "reviewing"
	case "reviewed":
		review, err := db.GetReviewByProjectID(project.ID)
		if err != nil || review == nil {
			return "reviewed"
		}
		return reviewStatusToStage(review)
	default:
		// For any project status we don't recognise, check reviews as fallback.
		review, err := db.GetReviewByProjectID(project.ID)
		if err != nil || review == nil {
			return project.Status
		}
		return reviewStatusToStage(review)
	}
}

// reviewStatusToStage maps a review's status to a workflow stage.
func reviewStatusToStage(review *models.Review) string {
	switch review.Status {
	case "pending", "running":
		return "reviewing"
	case "completed":
		return "reviewed"
	case "failed":
		return "parsed" // Review failed; effectively back to parsed stage.
	default:
		return "reviewing"
	}
}

// stageProgress returns a progress percentage for each workflow stage.
func stageProgress(stage string) int {
	switch stage {
	case "uploaded":
		return 10
	case "parsed":
		return 30
	case "reviewing":
		return 50
	case "reviewed":
		return 70
	case "routing":
		return 85
	case "complete":
		return 100
	default:
		return 0
	}
}

// stageMessage returns a human-readable description for each workflow stage.
func stageMessage(stage string) string {
	switch stage {
	case "uploaded":
		return "project uploaded, awaiting parsing"
	case "parsed":
		return "board parsed successfully, ready for review"
	case "reviewing":
		return "AI design review in progress"
	case "reviewed":
		return "design review complete"
	case "routing":
		return "auto-routing in progress"
	case "complete":
		return "workflow complete"
	default:
		return "unknown stage"
	}
}

// ---------------------------------------------------------------------------
// CrossProbe — GET /api/v1/workflow/:id/cross-probe?ref=U1&pin=3&net=GND
// Queries parsed board data to resolve component/net locations for
// schematic-to-PCB cross-probing.
// ---------------------------------------------------------------------------
func (h *WorkflowHandler) CrossProbe(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	projectID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid workflow/project ID"})
		return
	}

	ref := c.Query("ref")
	pin := c.Query("pin")
	net := c.Query("net")

	if ref == "" && net == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "at least one of 'ref' or 'net' query parameter is required",
		})
		return
	}

	// Verify project exists and user has access.
	project, err := db.GetProjectByID(projectID)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "project not found"})
		} else {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse{
				Error:   "failed to query project",
				Details: err.Error(),
			})
		}
		return
	}
	if project.UserID != userID {
		c.JSON(http.StatusForbidden, models.ErrorResponse{Error: "access denied"})
		return
	}

	if project.Status == "uploaded" || project.Status == "parsing" {
		c.JSON(http.StatusConflict, models.ErrorResponse{
			Error: "project has not been parsed yet",
			Code:  "NOT_PARSED",
		})
		return
	}

	// Fetch board data from the parser service.
	boardData, err := h.fetchBoardData(projectID, project.StorageKey, project.Format)
	if err != nil {
		c.JSON(http.StatusBadGateway, models.ErrorResponse{
			Error:   "failed to fetch board data from parser service",
			Details: err.Error(),
		})
		return
	}

	// Build the cross-probe result.
	result := resolveCrossProbe(boardData, ref, pin, net)
	result["workflow_id"] = projectID.String()
	result["ref"] = ref
	result["pin"] = pin
	result["net"] = net

	c.JSON(http.StatusOK, result)
}

// resolveCrossProbe finds component/net locations in the parsed board data.
func resolveCrossProbe(board *models.BoardData, ref, pin, net string) gin.H {
	var matchedComponent *models.Component
	var matchedPads []models.Pad
	var relatedNets []models.Net
	var boardLocations []gin.H

	// Build a layer-ID-to-name lookup.
	layerNames := make(map[int]string, len(board.Layers))
	for _, l := range board.Layers {
		layerNames[l.ID] = l.Name
	}

	// --- Resolve by component reference ---
	if ref != "" {
		for i := range board.Components {
			if board.Components[i].Reference == ref {
				matchedComponent = &board.Components[i]
				break
			}
		}

		if matchedComponent == nil {
			return gin.H{
				"found":     false,
				"error":     fmt.Sprintf("component %q not found on board", ref),
				"locations": []interface{}{},
			}
		}

		// Collect pads belonging to this component.
		for _, p := range board.Pads {
			if p.ComponentRef == ref {
				matchedPads = append(matchedPads, p)
			}
		}

		// If a specific pin was requested, filter pads to that index (1-based).
		if pin != "" {
			var pinFiltered []models.Pad
			// Attempt numeric pin matching by pad order.
			pinIdx := -1
			if n, err := fmt.Sscanf(pin, "%d", &pinIdx); err == nil && n == 1 && pinIdx >= 1 && pinIdx <= len(matchedPads) {
				pinFiltered = append(pinFiltered, matchedPads[pinIdx-1])
			}
			if len(pinFiltered) > 0 {
				matchedPads = pinFiltered
			}
			// If pin doesn't parse as a valid index, keep all pads.
		}

		// Collect nets connected to the matched pads.
		connectedNetIDs := make(map[int]bool)
		for _, p := range matchedPads {
			if p.NetID > 0 {
				connectedNetIDs[p.NetID] = true
			}
		}
		for _, n := range board.Nets {
			if connectedNetIDs[n.ID] {
				relatedNets = append(relatedNets, n)
			}
		}

		// Board location for the component itself.
		boardLocations = append(boardLocations, gin.H{
			"type":      "component",
			"reference": matchedComponent.Reference,
			"x":         matchedComponent.X,
			"y":         matchedComponent.Y,
			"rotation":  matchedComponent.Rotation,
			"layer_id":  matchedComponent.LayerID,
			"layer":     layerNames[matchedComponent.LayerID],
			"bounding_box": gin.H{
				"min_x": matchedComponent.BoundingBox.MinX,
				"min_y": matchedComponent.BoundingBox.MinY,
				"max_x": matchedComponent.BoundingBox.MaxX,
				"max_y": matchedComponent.BoundingBox.MaxY,
			},
		})

		// Add pad locations.
		for _, p := range matchedPads {
			boardLocations = append(boardLocations, gin.H{
				"type":          "pad",
				"component_ref": p.ComponentRef,
				"net_id":        p.NetID,
				"x":             p.X,
				"y":             p.Y,
				"width":         p.Width,
				"height":        p.Height,
				"shape":         p.Shape,
				"layer_id":      p.LayerID,
				"layer":         layerNames[p.LayerID],
			})
		}
	}

	// --- Resolve by net name ---
	if net != "" {
		var matchedNet *models.Net
		for i := range board.Nets {
			if board.Nets[i].Name == net {
				matchedNet = &board.Nets[i]
				break
			}
		}
		if matchedNet == nil {
			if ref == "" {
				return gin.H{
					"found":     false,
					"error":     fmt.Sprintf("net %q not found on board", net),
					"locations": []interface{}{},
				}
			}
			// ref was found but net wasn't — still return component data below.
		} else {
			// Collect all pads on this net.
			for _, p := range board.Pads {
				if p.NetID == matchedNet.ID {
					boardLocations = append(boardLocations, gin.H{
						"type":          "net_pad",
						"component_ref": p.ComponentRef,
						"net_id":        p.NetID,
						"net_name":      matchedNet.Name,
						"x":             p.X,
						"y":             p.Y,
						"layer_id":      p.LayerID,
						"layer":         layerNames[p.LayerID],
					})
				}
			}

			// Collect traces on this net.
			for _, t := range board.Traces {
				if t.NetID == matchedNet.ID && len(t.Points) > 0 {
					boardLocations = append(boardLocations, gin.H{
						"type":     "trace",
						"net_id":   t.NetID,
						"net_name": matchedNet.Name,
						"layer_id": t.LayerID,
						"layer":    layerNames[t.LayerID],
						"width":    t.Width,
						"start_x":  t.Points[0].X,
						"start_y":  t.Points[0].Y,
						"end_x":    t.Points[len(t.Points)-1].X,
						"end_y":    t.Points[len(t.Points)-1].Y,
					})
				}
			}

			if !containsNet(relatedNets, *matchedNet) {
				relatedNets = append(relatedNets, *matchedNet)
			}
		}
	}

	// Build schematic location from component position (a true schematic
	// cross-probe would need schematic data; here we return the board position
	// of the matched component as a reference point).
	var schematicLocation gin.H
	if matchedComponent != nil {
		schematicLocation = gin.H{
			"x":         matchedComponent.X,
			"y":         matchedComponent.Y,
			"reference": matchedComponent.Reference,
			"value":     matchedComponent.Value,
			"footprint": matchedComponent.Footprint,
		}
	}

	return gin.H{
		"found":              len(boardLocations) > 0,
		"schematic_location": schematicLocation,
		"board_locations":    boardLocations,
		"related_nets":       relatedNets,
		"pads":               matchedPads,
		"total_locations":    len(boardLocations),
	}
}

// containsNet checks if a net is already in the slice.
func containsNet(nets []models.Net, target models.Net) bool {
	for _, n := range nets {
		if n.ID == target.ID {
			return true
		}
	}
	return false
}

// fetchBoardData calls the parser service to get parsed board data.
func (h *WorkflowHandler) fetchBoardData(projectID uuid.UUID, storageKey, format string) (*models.BoardData, error) {
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

// ---------------------------------------------------------------------------
// Export — POST /api/v1/workflow/:id/export/:format
// Generates export files. Supports "bom" (CSV download), "gerber" (proxy to
// ML/parser service), and returns 501 for formats not yet implemented.
// ---------------------------------------------------------------------------
func (h *WorkflowHandler) Export(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	projectID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid workflow/project ID"})
		return
	}

	format := c.Param("format")
	validFormats := map[string]bool{
		"gerber": true, "bom": true, "pdf": true,
		"step": true, "odb": true, "ipc2581": true,
	}
	if !validFormats[format] {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error:   "unsupported export format",
			Details: "valid formats: gerber, bom, pdf, step, odb, ipc2581",
		})
		return
	}

	// Verify project exists and user has access.
	project, err := db.GetProjectByID(projectID)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "project not found"})
		} else {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse{
				Error:   "failed to query project",
				Details: err.Error(),
			})
		}
		return
	}
	if project.UserID != userID {
		c.JSON(http.StatusForbidden, models.ErrorResponse{Error: "access denied"})
		return
	}

	if project.Status == "uploaded" || project.Status == "parsing" {
		c.JSON(http.StatusConflict, models.ErrorResponse{
			Error: "project has not been parsed yet; cannot export",
			Code:  "NOT_PARSED",
		})
		return
	}

	switch format {
	case "bom":
		h.exportBOM(c, projectID, project)
	case "gerber":
		h.exportGerber(c, projectID, project)
	default:
		// pdf, step, odb, ipc2581 are not yet implemented.
		c.JSON(http.StatusNotImplemented, models.ErrorResponse{
			Error:   fmt.Sprintf("export format %q is not implemented yet", format),
			Code:    "NOT_IMPLEMENTED",
			Details: "this export format will be available in a future release",
		})
	}
}

// exportBOM fetches board data and generates a CSV BOM file download.
func (h *WorkflowHandler) exportBOM(c *gin.Context, projectID uuid.UUID, project *models.Project) {
	boardData, err := h.fetchBoardData(projectID, project.StorageKey, project.Format)
	if err != nil {
		c.JSON(http.StatusBadGateway, models.ErrorResponse{
			Error:   "failed to fetch board data for BOM generation",
			Details: err.Error(),
		})
		return
	}

	if len(boardData.Components) == 0 {
		c.JSON(http.StatusUnprocessableEntity, models.ErrorResponse{
			Error: "no components found on the board to generate BOM",
		})
		return
	}

	// Build a layer-ID-to-name lookup.
	layerNames := make(map[int]string, len(boardData.Layers))
	for _, l := range boardData.Layers {
		layerNames[l.ID] = l.Name
	}

	// Generate CSV content.
	var csv strings.Builder
	csv.WriteString("Reference,Value,Footprint,X,Y,Rotation,Layer\n")
	for _, comp := range boardData.Components {
		layerName := layerNames[comp.LayerID]
		if layerName == "" {
			layerName = fmt.Sprintf("layer_%d", comp.LayerID)
		}
		csv.WriteString(fmt.Sprintf("%s,%s,%s,%.4f,%.4f,%.1f,%s\n",
			escapeBOMField(comp.Reference),
			escapeBOMField(comp.Value),
			escapeBOMField(comp.Footprint),
			comp.X,
			comp.Y,
			comp.Rotation,
			escapeBOMField(layerName),
		))
	}

	fileName := fmt.Sprintf("%s_bom.csv", project.Name)
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", fileName))
	c.Data(http.StatusOK, "text/csv; charset=utf-8", []byte(csv.String()))
}

// escapeBOMField escapes a CSV field value (wraps in quotes if it contains
// commas, quotes, or newlines).
func escapeBOMField(s string) string {
	if strings.ContainsAny(s, ",\"\n\r") {
		return "\"" + strings.ReplaceAll(s, "\"", "\"\"") + "\""
	}
	return s
}

// exportGerber proxies the gerber export request to the ML/parser service.
func (h *WorkflowHandler) exportGerber(c *gin.Context, projectID uuid.UUID, project *models.Project) {
	payload := map[string]interface{}{
		"project_id":  projectID.String(),
		"storage_key": project.StorageKey,
		"format":      project.Format,
		"export_type": "gerber",
	}
	payloadBytes, _ := json.Marshal(payload)

	status, respBody, err := proxyToML("POST", "/ml/export/gerber", bytes.NewReader(payloadBytes))
	if err != nil {
		log.Printf("Gerber export proxy error: %v", err)
		c.JSON(http.StatusBadGateway, models.ErrorResponse{
			Error:   "export service unavailable",
			Details: err.Error(),
		})
		return
	}

	// If the ML service returned an error status, pass it through as JSON.
	if status >= 400 {
		c.Data(status, "application/json", respBody)
		return
	}

	// Return the gerber data as a file download.
	fileName := fmt.Sprintf("%s_gerber.zip", project.Name)
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", fileName))
	c.Data(status, "application/octet-stream", respBody)
}
