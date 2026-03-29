package models

import (
	"time"

	"github.com/google/uuid"
)

// User represents a registered user.
type User struct {
	ID           uuid.UUID `json:"id" db:"id"`
	Email        string    `json:"email" db:"email"`
	PasswordHash string    `json:"-" db:"password_hash"`
	Name         string    `json:"name" db:"name"`
	Tier         string    `json:"tier" db:"tier"` // "free", "pro", "team"
	TeamID       *uuid.UUID `json:"team_id,omitempty" db:"team_id"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

// Project represents an uploaded EDA project.
type Project struct {
	ID          uuid.UUID `json:"id" db:"id"`
	UserID      uuid.UUID `json:"user_id" db:"user_id"`
	Name        string    `json:"name" db:"name"`
	Description string    `json:"description" db:"description"`
	Status      string    `json:"status" db:"status"` // "uploaded", "parsing", "parsed", "reviewing", "reviewed", "error"
	Format      string    `json:"format" db:"format"` // "kicad", "eagle", "altium", "gerber"
	StorageKey  string    `json:"storage_key" db:"storage_key"`
	FileSize    int64     `json:"file_size" db:"file_size"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

// ProjectFile represents a single file within a project.
type ProjectFile struct {
	ID        uuid.UUID `json:"id" db:"id"`
	ProjectID uuid.UUID `json:"project_id" db:"project_id"`
	FileName  string    `json:"file_name" db:"file_name"`
	FilePath  string    `json:"file_path" db:"file_path"`
	FileType  string    `json:"file_type" db:"file_type"` // "schematic", "pcb", "library", "gerber", "drill", "other"
	FileSize  int64     `json:"file_size" db:"file_size"`
	MimeType  string    `json:"mime_type" db:"mime_type"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// Review represents an AI review of a project.
type Review struct {
	ID          uuid.UUID  `json:"id" db:"id"`
	ProjectID   uuid.UUID  `json:"project_id" db:"project_id"`
	UserID      uuid.UUID  `json:"user_id" db:"user_id"`
	Status      string     `json:"status" db:"status"` // "pending", "running", "completed", "failed"
	Summary     string     `json:"summary" db:"summary"`
	Score       *float64   `json:"score,omitempty" db:"score"`
	ItemCount   int        `json:"item_count" db:"item_count"`
	StartedAt   *time.Time `json:"started_at,omitempty" db:"started_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty" db:"completed_at"`
	ErrorMsg    string     `json:"error_msg,omitempty" db:"error_msg"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
}

// ReviewItem represents a single finding in a review.
type ReviewItem struct {
	ID         uuid.UUID `json:"id" db:"id"`
	ReviewID   uuid.UUID `json:"review_id" db:"review_id"`
	Category   string    `json:"category" db:"category"`     // "drc", "signal_integrity", "thermal", "manufacturing", "best_practice"
	Severity   string    `json:"severity" db:"severity"`     // "critical", "warning", "info", "suggestion"
	Title      string    `json:"title" db:"title"`
	Message    string    `json:"message" db:"message"`
	Location   string    `json:"location,omitempty" db:"location"` // JSON with layer, coordinates, component ref
	Suggestion string    `json:"suggestion,omitempty" db:"suggestion"`
	CreatedAt  time.Time `json:"created_at" db:"created_at"`
}

// ChatMessage represents a chat message in a project conversation.
type ChatMessage struct {
	ID        uuid.UUID `json:"id" db:"id"`
	ProjectID uuid.UUID `json:"project_id" db:"project_id"`
	UserID    uuid.UUID `json:"user_id" db:"user_id"`
	Role      string    `json:"role" db:"role"` // "user", "assistant"
	Content   string    `json:"content" db:"content"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// UsageRecord tracks API usage for rate limiting and billing.
type UsageRecord struct {
	ID        uuid.UUID `json:"id" db:"id"`
	UserID    uuid.UUID `json:"user_id" db:"user_id"`
	Action    string    `json:"action" db:"action"` // "review", "chat", "upload"
	ProjectID *uuid.UUID `json:"project_id,omitempty" db:"project_id"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// BoardData represents parsed board data for the renderer.
type BoardData struct {
	Layers     []Layer     `json:"layers"`
	Traces     []Trace     `json:"traces"`
	Pads       []Pad       `json:"pads"`
	Vias       []Via       `json:"vias"`
	Components []Component `json:"components"`
	Zones      []Zone      `json:"zones"`
	Outline    []Point     `json:"outline"`
	Nets       []Net       `json:"nets"`
	Width      float64     `json:"width"`
	Height     float64     `json:"height"`
}

type Layer struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	Type    string `json:"type"` // "copper", "silk", "mask", "paste", "fab", "edge"
	Color   string `json:"color"`
	Visible bool   `json:"visible"`
}

type Trace struct {
	NetID   int     `json:"net_id"`
	LayerID int     `json:"layer_id"`
	Width   float64 `json:"width"`
	Points  []Point `json:"points"`
}

type Pad struct {
	ComponentRef string  `json:"component_ref"`
	NetID        int     `json:"net_id"`
	LayerID      int     `json:"layer_id"`
	X            float64 `json:"x"`
	Y            float64 `json:"y"`
	Width        float64 `json:"width"`
	Height       float64 `json:"height"`
	Shape        string  `json:"shape"` // "circle", "rect", "oval", "custom"
	Rotation     float64 `json:"rotation"`
	DrillSize    float64 `json:"drill_size,omitempty"`
}

type Via struct {
	NetID     int     `json:"net_id"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	Diameter  float64 `json:"diameter"`
	DrillSize float64 `json:"drill_size"`
	StartLayer int    `json:"start_layer"`
	EndLayer   int    `json:"end_layer"`
}

type Component struct {
	Reference   string  `json:"reference"`
	Value       string  `json:"value"`
	Footprint   string  `json:"footprint"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	Rotation    float64 `json:"rotation"`
	LayerID     int     `json:"layer_id"`
	BoundingBox BBox    `json:"bounding_box"`
}

type BBox struct {
	MinX float64 `json:"min_x"`
	MinY float64 `json:"min_y"`
	MaxX float64 `json:"max_x"`
	MaxY float64 `json:"max_y"`
}

type Zone struct {
	NetID   int       `json:"net_id"`
	LayerID int       `json:"layer_id"`
	Points  []Point   `json:"points"`
	Fill    string    `json:"fill"` // "solid", "hatched", "none"
}

type Net struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Class string `json:"class,omitempty"`
}

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// API request/response types

type RegisterRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8"`
	Name     string `json:"name" binding:"required"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

type AuthResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	User         User   `json:"user"`
}

type ChatRequest struct {
	Message string `json:"message" binding:"required"`
}

type ChatResponse struct {
	Reply   ChatMessage `json:"reply"`
	History []ChatMessage `json:"history,omitempty"`
}

type PaginatedResponse struct {
	Data       interface{} `json:"data"`
	Total      int         `json:"total"`
	Page       int         `json:"page"`
	PerPage    int         `json:"per_page"`
	TotalPages int         `json:"total_pages"`
}

type ErrorResponse struct {
	Error   string `json:"error"`
	Code    string `json:"code,omitempty"`
	Details string `json:"details,omitempty"`
}
