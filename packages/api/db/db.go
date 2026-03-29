package db

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "github.com/lib/pq"
	"github.com/google/uuid"

	"routeai/api/models"
)

var DB *sql.DB

const migrationsSQL = `
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    tier VARCHAR(50) NOT NULL DEFAULT 'free',
    team_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status VARCHAR(50) NOT NULL DEFAULT 'uploaded',
    format VARCHAR(50) NOT NULL DEFAULT '',
    storage_key VARCHAR(512) NOT NULL DEFAULT '',
    file_size BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(512) NOT NULL,
    file_type VARCHAR(50) NOT NULL DEFAULT 'other',
    file_size BIGINT NOT NULL DEFAULT 0,
    mime_type VARCHAR(100) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    summary TEXT NOT NULL DEFAULT '',
    score DOUBLE PRECISION,
    item_count INT NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_msg TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    severity VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    suggestion TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    project_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_project_id ON reviews(project_id);
CREATE INDEX IF NOT EXISTS idx_review_items_review_id ON review_items(review_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_project_id ON chat_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_usage_records_user_id ON usage_records(user_id);
`

// InitDB opens a connection to PostgreSQL and runs migrations.
func InitDB(connString string) error {
	var err error
	DB, err = sql.Open("postgres", connString)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	DB.SetMaxOpenConns(25)
	DB.SetMaxIdleConns(5)
	DB.SetConnMaxLifetime(5 * time.Minute)

	if err := DB.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	log.Println("Database connected successfully")

	if _, err := DB.Exec(migrationsSQL); err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	log.Println("Database migrations completed")
	return nil
}

// --- User CRUD ---

func CreateUser(user *models.User) error {
	return DB.QueryRow(
		`INSERT INTO users (email, password_hash, name, tier)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, created_at, updated_at`,
		user.Email, user.PasswordHash, user.Name, user.Tier,
	).Scan(&user.ID, &user.CreatedAt, &user.UpdatedAt)
}

func GetUserByEmail(email string) (*models.User, error) {
	user := &models.User{}
	err := DB.QueryRow(
		`SELECT id, email, password_hash, name, tier, team_id, created_at, updated_at
		 FROM users WHERE email = $1`,
		email,
	).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.Name, &user.Tier,
		&user.TeamID, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return user, nil
}

func GetUserByID(id uuid.UUID) (*models.User, error) {
	user := &models.User{}
	err := DB.QueryRow(
		`SELECT id, email, password_hash, name, tier, team_id, created_at, updated_at
		 FROM users WHERE id = $1`,
		id,
	).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.Name, &user.Tier,
		&user.TeamID, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return user, nil
}

// --- Project CRUD ---

func CreateProject(p *models.Project) error {
	return DB.QueryRow(
		`INSERT INTO projects (user_id, name, description, status, format, storage_key, file_size)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id, created_at, updated_at`,
		p.UserID, p.Name, p.Description, p.Status, p.Format, p.StorageKey, p.FileSize,
	).Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt)
}

func GetProjectByID(id uuid.UUID) (*models.Project, error) {
	p := &models.Project{}
	err := DB.QueryRow(
		`SELECT id, user_id, name, description, status, format, storage_key, file_size, created_at, updated_at
		 FROM projects WHERE id = $1`,
		id,
	).Scan(&p.ID, &p.UserID, &p.Name, &p.Description, &p.Status, &p.Format,
		&p.StorageKey, &p.FileSize, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return p, nil
}

func ListProjectsByUser(userID uuid.UUID, page, perPage int) ([]models.Project, int, error) {
	var total int
	err := DB.QueryRow(
		`SELECT COUNT(*) FROM projects WHERE user_id = $1`,
		userID,
	).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	rows, err := DB.Query(
		`SELECT id, user_id, name, description, status, format, storage_key, file_size, created_at, updated_at
		 FROM projects WHERE user_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2 OFFSET $3`,
		userID, perPage, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var projects []models.Project
	for rows.Next() {
		var p models.Project
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.Description, &p.Status,
			&p.Format, &p.StorageKey, &p.FileSize, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, 0, err
		}
		projects = append(projects, p)
	}
	return projects, total, rows.Err()
}

func UpdateProjectStatus(id uuid.UUID, status string) error {
	_, err := DB.Exec(
		`UPDATE projects SET status = $1, updated_at = NOW() WHERE id = $2`,
		status, id,
	)
	return err
}

func DeleteProject(id uuid.UUID) error {
	_, err := DB.Exec(`DELETE FROM projects WHERE id = $1`, id)
	return err
}

// --- Review CRUD ---

func CreateReview(r *models.Review) error {
	return DB.QueryRow(
		`INSERT INTO reviews (project_id, user_id, status)
		 VALUES ($1, $2, $3)
		 RETURNING id, created_at`,
		r.ProjectID, r.UserID, r.Status,
	).Scan(&r.ID, &r.CreatedAt)
}

func GetReviewByProjectID(projectID uuid.UUID) (*models.Review, error) {
	r := &models.Review{}
	err := DB.QueryRow(
		`SELECT id, project_id, user_id, status, summary, score, item_count,
		        started_at, completed_at, error_msg, created_at
		 FROM reviews WHERE project_id = $1
		 ORDER BY created_at DESC LIMIT 1`,
		projectID,
	).Scan(&r.ID, &r.ProjectID, &r.UserID, &r.Status, &r.Summary, &r.Score,
		&r.ItemCount, &r.StartedAt, &r.CompletedAt, &r.ErrorMsg, &r.CreatedAt)
	if err != nil {
		return nil, err
	}
	return r, nil
}

func UpdateReview(r *models.Review) error {
	_, err := DB.Exec(
		`UPDATE reviews
		 SET status = $1, summary = $2, score = $3, item_count = $4,
		     started_at = $5, completed_at = $6, error_msg = $7
		 WHERE id = $8`,
		r.Status, r.Summary, r.Score, r.ItemCount,
		r.StartedAt, r.CompletedAt, r.ErrorMsg, r.ID,
	)
	return err
}

// --- Review Items ---

func CreateReviewItem(item *models.ReviewItem) error {
	return DB.QueryRow(
		`INSERT INTO review_items (review_id, category, severity, title, message, location, suggestion)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id, created_at`,
		item.ReviewID, item.Category, item.Severity, item.Title,
		item.Message, item.Location, item.Suggestion,
	).Scan(&item.ID, &item.CreatedAt)
}

func ListReviewItems(reviewID uuid.UUID, category, severity string) ([]models.ReviewItem, error) {
	query := `SELECT id, review_id, category, severity, title, message, location, suggestion, created_at
		      FROM review_items WHERE review_id = $1`
	args := []interface{}{reviewID}
	argIdx := 2

	if category != "" {
		query += fmt.Sprintf(" AND category = $%d", argIdx)
		args = append(args, category)
		argIdx++
	}
	if severity != "" {
		query += fmt.Sprintf(" AND severity = $%d", argIdx)
		args = append(args, severity)
	}

	query += " ORDER BY created_at ASC"

	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.ReviewItem
	for rows.Next() {
		var item models.ReviewItem
		if err := rows.Scan(&item.ID, &item.ReviewID, &item.Category, &item.Severity,
			&item.Title, &item.Message, &item.Location, &item.Suggestion, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// --- Chat Messages ---

func CreateChatMessage(msg *models.ChatMessage) error {
	return DB.QueryRow(
		`INSERT INTO chat_messages (project_id, user_id, role, content)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, created_at`,
		msg.ProjectID, msg.UserID, msg.Role, msg.Content,
	).Scan(&msg.ID, &msg.CreatedAt)
}

func ListChatMessages(projectID uuid.UUID) ([]models.ChatMessage, error) {
	rows, err := DB.Query(
		`SELECT id, project_id, user_id, role, content, created_at
		 FROM chat_messages WHERE project_id = $1
		 ORDER BY created_at ASC`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []models.ChatMessage
	for rows.Next() {
		var msg models.ChatMessage
		if err := rows.Scan(&msg.ID, &msg.ProjectID, &msg.UserID, &msg.Role,
			&msg.Content, &msg.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, msg)
	}
	return messages, rows.Err()
}

// --- Usage Records ---

func CreateUsageRecord(rec *models.UsageRecord) error {
	return DB.QueryRow(
		`INSERT INTO usage_records (user_id, action, project_id)
		 VALUES ($1, $2, $3)
		 RETURNING id, created_at`,
		rec.UserID, rec.Action, rec.ProjectID,
	).Scan(&rec.ID, &rec.CreatedAt)
}

func CountUserReviewsThisMonth(userID uuid.UUID) (int, error) {
	var count int
	err := DB.QueryRow(
		`SELECT COUNT(*) FROM usage_records
		 WHERE user_id = $1 AND action = 'review'
		 AND created_at >= date_trunc('month', NOW())`,
		userID,
	).Scan(&count)
	return count, err
}
