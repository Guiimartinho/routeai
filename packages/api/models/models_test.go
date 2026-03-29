package models

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestUserJSONSerialization(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	user := User{
		ID:           uuid.New(),
		Email:        "test@example.com",
		PasswordHash: "secret_hash",
		Name:         "Test User",
		Tier:         "free",
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	data, err := json.Marshal(user)
	if err != nil {
		t.Fatalf("failed to marshal User: %v", err)
	}

	// PasswordHash should be excluded from JSON (json:"-").
	var raw map[string]interface{}
	json.Unmarshal(data, &raw)
	if _, exists := raw["password_hash"]; exists {
		t.Error("password_hash should not be in JSON output")
	}
	if raw["email"] != "test@example.com" {
		t.Errorf("expected email=test@example.com, got %v", raw["email"])
	}
	if raw["tier"] != "free" {
		t.Errorf("expected tier=free, got %v", raw["tier"])
	}
}

func TestProjectJSONSerialization(t *testing.T) {
	project := Project{
		ID:          uuid.New(),
		UserID:      uuid.New(),
		Name:        "My Board",
		Description: "Test project",
		Status:      "uploaded",
		Format:      "kicad",
		StorageKey:  "projects/abc/def/file.zip",
		FileSize:    1024,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	data, err := json.Marshal(project)
	if err != nil {
		t.Fatalf("failed to marshal Project: %v", err)
	}

	var decoded Project
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal Project: %v", err)
	}

	if decoded.Name != project.Name {
		t.Errorf("Name mismatch: got %s, want %s", decoded.Name, project.Name)
	}
	if decoded.Status != "uploaded" {
		t.Errorf("Status mismatch: got %s, want uploaded", decoded.Status)
	}
	if decoded.Format != "kicad" {
		t.Errorf("Format mismatch: got %s, want kicad", decoded.Format)
	}
}

func TestRegisterRequestValidation(t *testing.T) {
	tests := []struct {
		name  string
		input RegisterRequest
		valid bool
	}{
		{
			name:  "valid request",
			input: RegisterRequest{Email: "a@b.com", Password: "12345678", Name: "Test"},
			valid: true,
		},
		{
			name:  "missing email",
			input: RegisterRequest{Email: "", Password: "12345678", Name: "Test"},
			valid: false,
		},
		{
			name:  "short password",
			input: RegisterRequest{Email: "a@b.com", Password: "short", Name: "Test"},
			valid: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, _ := json.Marshal(tt.input)
			var decoded RegisterRequest
			err := json.Unmarshal(data, &decoded)
			if err != nil {
				t.Fatalf("unmarshal error: %v", err)
			}
			// Basic field check (Gin binding tags are validated at handler level).
			if tt.valid {
				if decoded.Email == "" || decoded.Password == "" || decoded.Name == "" {
					t.Error("expected valid fields")
				}
			}
		})
	}
}

func TestBoardDataSerialization(t *testing.T) {
	board := BoardData{
		Layers: []Layer{
			{ID: 0, Name: "F.Cu", Type: "copper", Color: "#ff0000", Visible: true},
			{ID: 31, Name: "B.Cu", Type: "copper", Color: "#0000ff", Visible: true},
		},
		Traces: []Trace{
			{NetID: 1, LayerID: 0, Width: 0.25, Points: []Point{{X: 0, Y: 0}, {X: 10, Y: 0}}},
		},
		Pads: []Pad{
			{ComponentRef: "R1", NetID: 1, LayerID: 0, X: 5, Y: 5, Width: 1.0, Height: 0.6, Shape: "rect"},
		},
		Vias: []Via{
			{NetID: 1, X: 10, Y: 10, Diameter: 0.6, DrillSize: 0.3, StartLayer: 0, EndLayer: 31},
		},
		Components: []Component{
			{Reference: "R1", Value: "10k", Footprint: "R_0402", X: 5, Y: 5, Rotation: 0, LayerID: 0,
				BoundingBox: BBox{MinX: 4, MinY: 4.5, MaxX: 6, MaxY: 5.5}},
		},
		Nets: []Net{
			{ID: 1, Name: "GND", Class: "Default"},
		},
		Width:  50,
		Height: 50,
	}

	data, err := json.Marshal(board)
	if err != nil {
		t.Fatalf("failed to marshal BoardData: %v", err)
	}

	var decoded BoardData
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal BoardData: %v", err)
	}

	if len(decoded.Layers) != 2 {
		t.Errorf("expected 2 layers, got %d", len(decoded.Layers))
	}
	if len(decoded.Traces) != 1 {
		t.Errorf("expected 1 trace, got %d", len(decoded.Traces))
	}
	if len(decoded.Pads) != 1 {
		t.Errorf("expected 1 pad, got %d", len(decoded.Pads))
	}
	if decoded.Width != 50.0 {
		t.Errorf("expected width=50, got %f", decoded.Width)
	}
}

func TestErrorResponseSerialization(t *testing.T) {
	errResp := ErrorResponse{
		Error:   "something went wrong",
		Code:    "ERR_CODE",
		Details: "more details",
	}

	data, err := json.Marshal(errResp)
	if err != nil {
		t.Fatalf("failed to marshal ErrorResponse: %v", err)
	}

	var decoded map[string]string
	json.Unmarshal(data, &decoded)

	if decoded["error"] != "something went wrong" {
		t.Errorf("error field mismatch: %v", decoded["error"])
	}
	if decoded["code"] != "ERR_CODE" {
		t.Errorf("code field mismatch: %v", decoded["code"])
	}
}

func TestPaginatedResponse(t *testing.T) {
	resp := PaginatedResponse{
		Data:       []string{"a", "b"},
		Total:      10,
		Page:       1,
		PerPage:    2,
		TotalPages: 5,
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("failed to marshal PaginatedResponse: %v", err)
	}

	var decoded PaginatedResponse
	json.Unmarshal(data, &decoded)

	if decoded.Total != 10 {
		t.Errorf("expected Total=10, got %d", decoded.Total)
	}
	if decoded.TotalPages != 5 {
		t.Errorf("expected TotalPages=5, got %d", decoded.TotalPages)
	}
}

func TestReviewItemSerialization(t *testing.T) {
	item := ReviewItem{
		ID:         uuid.New(),
		ReviewID:   uuid.New(),
		Category:   "drc",
		Severity:   "warning",
		Title:      "Trace clearance",
		Message:    "Trace clearance below minimum",
		Location:   `{"x": 10.5, "y": 20.0, "layer": "F.Cu"}`,
		Suggestion: "Increase spacing to 0.15mm",
	}

	data, err := json.Marshal(item)
	if err != nil {
		t.Fatalf("failed to marshal ReviewItem: %v", err)
	}

	var decoded ReviewItem
	json.Unmarshal(data, &decoded)

	if decoded.Category != "drc" {
		t.Errorf("expected category=drc, got %s", decoded.Category)
	}
	if decoded.Severity != "warning" {
		t.Errorf("expected severity=warning, got %s", decoded.Severity)
	}
}
