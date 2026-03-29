package audit

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// QueryFilter defines filters for searching audit logs.
type QueryFilter struct {
	UserID       *uuid.UUID `json:"user_id,omitempty"`
	Action       string     `json:"action,omitempty"`
	ResourceType string     `json:"resource_type,omitempty"`
	ResourceID   string     `json:"resource_id,omitempty"`
	IPAddress    string     `json:"ip_address,omitempty"`
	StartDate    *time.Time `json:"start_date,omitempty"`
	EndDate      *time.Time `json:"end_date,omitempty"`
	Page         int        `json:"page"`
	PerPage      int        `json:"per_page"`
}

// QueryResult holds a paginated set of audit events.
type QueryResult struct {
	Events     []AuditEvent `json:"events"`
	Total      int          `json:"total"`
	Page       int          `json:"page"`
	PerPage    int          `json:"per_page"`
	TotalPages int          `json:"total_pages"`
}

// QueryAuditLogs searches the audit_logs table with optional filters and
// pagination. Filters are combined with AND logic.
func QueryAuditLogs(db *sql.DB, filter QueryFilter) (*QueryResult, error) {
	if filter.Page <= 0 {
		filter.Page = 1
	}
	if filter.PerPage <= 0 {
		filter.PerPage = 50
	}
	if filter.PerPage > 500 {
		filter.PerPage = 500
	}

	var conditions []string
	var args []interface{}
	argIdx := 1

	if filter.UserID != nil {
		conditions = append(conditions, fmt.Sprintf("user_id = $%d", argIdx))
		args = append(args, *filter.UserID)
		argIdx++
	}
	if filter.Action != "" {
		conditions = append(conditions, fmt.Sprintf("action = $%d", argIdx))
		args = append(args, filter.Action)
		argIdx++
	}
	if filter.ResourceType != "" {
		conditions = append(conditions, fmt.Sprintf("resource_type = $%d", argIdx))
		args = append(args, filter.ResourceType)
		argIdx++
	}
	if filter.ResourceID != "" {
		conditions = append(conditions, fmt.Sprintf("resource_id = $%d", argIdx))
		args = append(args, filter.ResourceID)
		argIdx++
	}
	if filter.IPAddress != "" {
		conditions = append(conditions, fmt.Sprintf("ip_address = $%d", argIdx))
		args = append(args, filter.IPAddress)
		argIdx++
	}
	if filter.StartDate != nil {
		conditions = append(conditions, fmt.Sprintf("timestamp >= $%d", argIdx))
		args = append(args, *filter.StartDate)
		argIdx++
	}
	if filter.EndDate != nil {
		conditions = append(conditions, fmt.Sprintf("timestamp <= $%d", argIdx))
		args = append(args, *filter.EndDate)
		argIdx++
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	// Count total matching records.
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM audit_logs %s", where)
	var total int
	if err := db.QueryRow(countSQL, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count audit logs: %w", err)
	}

	totalPages := (total + filter.PerPage - 1) / filter.PerPage
	offset := (filter.Page - 1) * filter.PerPage

	// Fetch the page of events.
	fetchSQL := fmt.Sprintf(
		`SELECT id, user_id, action, resource_type, resource_id, details,
		        ip_address, user_agent, status_code, timestamp
		 FROM audit_logs
		 %s
		 ORDER BY timestamp DESC
		 LIMIT $%d OFFSET $%d`,
		where, argIdx, argIdx+1,
	)
	args = append(args, filter.PerPage, offset)

	rows, err := db.Query(fetchSQL, args...)
	if err != nil {
		return nil, fmt.Errorf("query audit logs: %w", err)
	}
	defer rows.Close()

	var events []AuditEvent
	for rows.Next() {
		var e AuditEvent
		if err := rows.Scan(&e.ID, &e.UserID, &e.Action, &e.ResourceType,
			&e.ResourceID, &e.Details, &e.IPAddress, &e.UserAgent,
			&e.StatusCode, &e.Timestamp); err != nil {
			return nil, fmt.Errorf("scan audit event: %w", err)
		}
		events = append(events, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &QueryResult{
		Events:     events,
		Total:      total,
		Page:       filter.Page,
		PerPage:    filter.PerPage,
		TotalPages: totalPages,
	}, nil
}

// ExportCSV writes audit log query results as CSV-formatted bytes.
// Columns: id, user_id, action, resource_type, resource_id, ip_address,
// user_agent, status_code, timestamp, details
func ExportCSV(db *sql.DB, filter QueryFilter) ([]byte, error) {
	// Remove pagination for CSV export -- fetch all matching rows.
	filter.Page = 1
	filter.PerPage = 100000

	result, err := QueryAuditLogs(db, filter)
	if err != nil {
		return nil, err
	}

	var buf strings.Builder
	// Header row.
	buf.WriteString("id,user_id,action,resource_type,resource_id,ip_address,user_agent,status_code,timestamp,details\n")

	for _, e := range result.Events {
		userIDStr := ""
		if e.UserID != nil {
			userIDStr = e.UserID.String()
		}
		detailsStr := ""
		if e.Details != nil {
			// Escape double quotes in JSON for CSV.
			raw := string(e.Details)
			detailsStr = strings.ReplaceAll(raw, "\"", "\"\"")
		}
		line := fmt.Sprintf("%s,%s,%s,%s,%s,%s,\"%s\",%d,%s,\"%s\"\n",
			e.ID.String(),
			userIDStr,
			csvEscape(e.Action),
			csvEscape(e.ResourceType),
			csvEscape(e.ResourceID),
			csvEscape(e.IPAddress),
			csvEscape(e.UserAgent),
			e.StatusCode,
			e.Timestamp.Format(time.RFC3339),
			detailsStr,
		)
		buf.WriteString(line)
	}

	return []byte(buf.String()), nil
}

// ExportJSON writes audit log query results as a JSON array.
func ExportJSON(db *sql.DB, filter QueryFilter) ([]byte, error) {
	filter.Page = 1
	filter.PerPage = 100000

	result, err := QueryAuditLogs(db, filter)
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(result.Events, "", "  ")
}

// csvEscape escapes a string value for safe inclusion in a CSV cell.
func csvEscape(s string) string {
	if strings.ContainsAny(s, ",\"\n\r") {
		return "\"" + strings.ReplaceAll(s, "\"", "\"\"") + "\""
	}
	return s
}
