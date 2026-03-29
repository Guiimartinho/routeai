package audit

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Action constants for auditable operations.
const (
	ActionLogin          = "LOGIN"
	ActionLogout         = "LOGOUT"
	ActionProjectCreate  = "PROJECT_CREATE"
	ActionProjectDelete  = "PROJECT_DELETE"
	ActionProjectUpdate  = "PROJECT_UPDATE"
	ActionProjectView    = "PROJECT_VIEW"
	ActionReviewStart    = "REVIEW_START"
	ActionReviewComplete = "REVIEW_COMPLETE"
	ActionDesignExport   = "DESIGN_EXPORT"
	ActionDesignImport   = "DESIGN_IMPORT"
	ActionSettingsChange = "SETTINGS_CHANGE"
	ActionUserInvite     = "USER_INVITE"
	ActionUserRemove     = "USER_REMOVE"
	ActionRoleChange     = "ROLE_CHANGE"
	ActionChatMessage    = "CHAT_MESSAGE"
	ActionBranchCreate   = "BRANCH_CREATE"
	ActionBranchMerge    = "BRANCH_MERGE"
	ActionCommitCreate   = "COMMIT_CREATE"
	ActionSSOLogin       = "SSO_LOGIN"
	ActionAPICall        = "API_CALL"
)

// AuditEvent represents a single auditable action.
type AuditEvent struct {
	ID           uuid.UUID       `json:"id" db:"id"`
	UserID       *uuid.UUID      `json:"user_id,omitempty" db:"user_id"`
	Action       string          `json:"action" db:"action"`
	ResourceType string          `json:"resource_type" db:"resource_type"`
	ResourceID   string          `json:"resource_id,omitempty" db:"resource_id"`
	Details      json.RawMessage `json:"details,omitempty" db:"details"`
	IPAddress    string          `json:"ip_address" db:"ip_address"`
	UserAgent    string          `json:"user_agent,omitempty" db:"user_agent"`
	StatusCode   int             `json:"status_code,omitempty" db:"status_code"`
	Timestamp    time.Time       `json:"timestamp" db:"timestamp"`
}

// auditMigrationSQL creates the audit_logs table.
const auditMigrationSQL = `
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL DEFAULT '',
    resource_id VARCHAR(255) NOT NULL DEFAULT '',
    details JSONB,
    ip_address VARCHAR(45) NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    status_code INT NOT NULL DEFAULT 0,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
`

// AuditLogger writes audit events to PostgreSQL.
type AuditLogger struct {
	db *sql.DB
}

// NewAuditLogger creates an audit logger and runs database migrations.
func NewAuditLogger(db *sql.DB) (*AuditLogger, error) {
	if _, err := db.Exec(auditMigrationSQL); err != nil {
		return nil, fmt.Errorf("audit migration failed: %w", err)
	}
	return &AuditLogger{db: db}, nil
}

// Log writes a single audit event to the database. It is designed to be
// non-blocking: errors are logged but do not propagate to the caller so
// that audit failures never break normal request processing.
func (al *AuditLogger) Log(event AuditEvent) {
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now().UTC()
	}
	if event.Details == nil {
		event.Details = json.RawMessage("{}")
	}

	_, err := al.db.Exec(
		`INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address, user_agent, status_code, timestamp)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		event.UserID, event.Action, event.ResourceType, event.ResourceID,
		event.Details, event.IPAddress, event.UserAgent, event.StatusCode, event.Timestamp,
	)
	if err != nil {
		log.Printf("audit: failed to log event %s: %v", event.Action, err)
	}
}

// LogAsync writes an audit event in a goroutine so the caller is not blocked.
func (al *AuditLogger) LogAsync(event AuditEvent) {
	go al.Log(event)
}

// AuditMiddleware returns Gin middleware that automatically logs every API
// request as an audit event. It captures the request method, path, status
// code, user identity (from JWT context), and client IP.
func AuditMiddleware(logger *AuditLogger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now().UTC()

		// Process the request.
		c.Next()

		// Build audit event from request context.
		var userID *uuid.UUID
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userID = &id
			}
		}

		action := resolveAction(c.Request.Method, c.FullPath())
		resourceType, resourceID := resolveResource(c)

		details := map[string]interface{}{
			"method":   c.Request.Method,
			"path":     c.Request.URL.Path,
			"query":    c.Request.URL.RawQuery,
			"latency":  time.Since(start).Milliseconds(),
		}
		detailsJSON, _ := json.Marshal(details)

		logger.LogAsync(AuditEvent{
			UserID:       userID,
			Action:       action,
			ResourceType: resourceType,
			ResourceID:   resourceID,
			Details:      detailsJSON,
			IPAddress:    c.ClientIP(),
			UserAgent:    c.Request.UserAgent(),
			StatusCode:   c.Writer.Status(),
			Timestamp:    start,
		})
	}
}

// resolveAction maps HTTP method + route to a human-readable audit action.
func resolveAction(method, route string) string {
	switch {
	case route == "/api/v1/auth/login" && method == "POST":
		return ActionLogin
	case route == "/api/v1/auth/register" && method == "POST":
		return "REGISTER"
	case route == "/api/v1/projects" && method == "POST":
		return ActionProjectCreate
	case route == "/api/v1/projects/:id" && method == "DELETE":
		return ActionProjectDelete
	case route == "/api/v1/projects/:id" && method == "GET":
		return ActionProjectView
	case route == "/api/v1/projects/:id/review" && method == "POST":
		return ActionReviewStart
	case route == "/api/v1/projects/:id/chat" && method == "POST":
		return ActionChatMessage
	default:
		return ActionAPICall
	}
}

// resolveResource extracts the resource type and ID from the request context.
func resolveResource(c *gin.Context) (string, string) {
	path := c.FullPath()

	switch {
	case contains(path, "/projects/:id/review"):
		return "review", c.Param("id")
	case contains(path, "/projects/:id/chat"):
		return "chat", c.Param("id")
	case contains(path, "/projects/:id/board"):
		return "board", c.Param("id")
	case contains(path, "/projects/:id"):
		return "project", c.Param("id")
	case contains(path, "/projects"):
		return "project", ""
	case contains(path, "/auth"):
		return "auth", ""
	default:
		return "api", ""
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > len(substr) && searchString(s, substr))
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
