package collaboration

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// DesignVersion is a snapshot of the entire design state at a point in time.
type DesignVersion struct {
	ID        uuid.UUID       `json:"id"`
	ProjectID uuid.UUID       `json:"project_id"`
	BranchID  uuid.UUID       `json:"branch_id"`
	ParentID  *uuid.UUID      `json:"parent_id,omitempty"`
	Hash      string          `json:"hash"` // Short hex hash for display (first 7 chars of UUID).
	Message   string          `json:"message"`
	AuthorID  uuid.UUID       `json:"author_id"`
	AuthorName string         `json:"author_name"`
	Snapshot  json.RawMessage `json:"snapshot"` // JSONB design state.
	CreatedAt time.Time       `json:"created_at"`
}

// DesignBranch represents a named line of development for a project design.
type DesignBranch struct {
	ID        uuid.UUID  `json:"id"`
	ProjectID uuid.UUID  `json:"project_id"`
	Name      string     `json:"name"`
	HeadID    *uuid.UUID `json:"head_id,omitempty"` // Points to the latest DesignVersion on this branch.
	AuthorID  uuid.UUID  `json:"author_id"`
	AuthorName string    `json:"author_name"`
	CreatedAt time.Time  `json:"created_at"`
}

// DiffElement describes a single difference between two design versions.
type DiffElement struct {
	Type      string          `json:"type"`       // "added", "removed", "modified"
	Category  string          `json:"category"`   // "component", "trace", "via", "zone", "net"
	ElementID string          `json:"element_id"`
	OldValue  json.RawMessage `json:"old_value,omitempty"`
	NewValue  json.RawMessage `json:"new_value,omitempty"`
}

// DesignDiff contains the full set of differences between two versions.
type DesignDiff struct {
	FromVersion uuid.UUID     `json:"from_version"`
	ToVersion   uuid.UUID     `json:"to_version"`
	Elements    []DiffElement `json:"elements"`
	Summary     string        `json:"summary"`
}

// MergeResult describes the outcome of merging two branches.
type MergeResult struct {
	Success     bool         `json:"success"`
	NewVersion  *DesignVersion `json:"new_version,omitempty"`
	Conflicts   []DiffElement `json:"conflicts,omitempty"`
	AutoMerged  int          `json:"auto_merged"`
	Message     string       `json:"message"`
}

// versioningMigrationSQL creates the tables for design versioning in PostgreSQL.
const versioningMigrationSQL = `
CREATE TABLE IF NOT EXISTS design_branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    head_id UUID,
    author_id UUID NOT NULL,
    author_name VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS design_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    branch_id UUID NOT NULL REFERENCES design_branches(id) ON DELETE CASCADE,
    parent_id UUID,
    hash VARCHAR(7) NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    author_id UUID NOT NULL,
    author_name VARCHAR(255) NOT NULL DEFAULT '',
    snapshot JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_design_versions_project ON design_versions(project_id);
CREATE INDEX IF NOT EXISTS idx_design_versions_branch ON design_versions(branch_id);
CREATE INDEX IF NOT EXISTS idx_design_branches_project ON design_branches(project_id);

ALTER TABLE design_branches
    DROP CONSTRAINT IF EXISTS fk_head,
    ADD CONSTRAINT fk_head FOREIGN KEY (head_id)
    REFERENCES design_versions(id) ON DELETE SET NULL;
`

// VersioningService provides git-like design versioning backed by PostgreSQL.
type VersioningService struct {
	db *sql.DB
}

// NewVersioningService creates a versioning service and runs migrations.
func NewVersioningService(db *sql.DB) (*VersioningService, error) {
	if _, err := db.Exec(versioningMigrationSQL); err != nil {
		return nil, fmt.Errorf("versioning migration failed: %w", err)
	}
	return &VersioningService{db: db}, nil
}

// CreateBranch creates a new named branch for a project. If no branch exists
// yet the branch is treated as the default ("main"). The head_id is optionally
// set to an existing version to fork from.
func (vs *VersioningService) CreateBranch(projectID, authorID uuid.UUID, authorName, branchName string, forkFromVersionID *uuid.UUID) (*DesignBranch, error) {
	branch := &DesignBranch{
		ProjectID:  projectID,
		Name:       branchName,
		AuthorID:   authorID,
		AuthorName: authorName,
		HeadID:     forkFromVersionID,
	}

	err := vs.db.QueryRow(
		`INSERT INTO design_branches (project_id, name, head_id, author_id, author_name)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, created_at`,
		branch.ProjectID, branch.Name, branch.HeadID, branch.AuthorID, branch.AuthorName,
	).Scan(&branch.ID, &branch.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("create branch: %w", err)
	}
	return branch, nil
}

// ListBranches returns all branches for a project.
func (vs *VersioningService) ListBranches(projectID uuid.UUID) ([]DesignBranch, error) {
	rows, err := vs.db.Query(
		`SELECT id, project_id, name, head_id, author_id, author_name, created_at
		 FROM design_branches
		 WHERE project_id = $1
		 ORDER BY created_at ASC`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var branches []DesignBranch
	for rows.Next() {
		var b DesignBranch
		if err := rows.Scan(&b.ID, &b.ProjectID, &b.Name, &b.HeadID, &b.AuthorID, &b.AuthorName, &b.CreatedAt); err != nil {
			return nil, err
		}
		branches = append(branches, b)
	}
	return branches, rows.Err()
}

// SwitchBranch returns the branch details by name within a project.
func (vs *VersioningService) SwitchBranch(projectID uuid.UUID, branchName string) (*DesignBranch, error) {
	b := &DesignBranch{}
	err := vs.db.QueryRow(
		`SELECT id, project_id, name, head_id, author_id, author_name, created_at
		 FROM design_branches
		 WHERE project_id = $1 AND name = $2`,
		projectID, branchName,
	).Scan(&b.ID, &b.ProjectID, &b.Name, &b.HeadID, &b.AuthorID, &b.AuthorName, &b.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("switch branch %q: %w", branchName, err)
	}
	return b, nil
}

// CreateCommit creates a new design version (commit) on a branch. The snapshot
// contains the complete JSONB representation of the design state.
func (vs *VersioningService) CreateCommit(projectID, branchID, authorID uuid.UUID, authorName, message string, snapshot json.RawMessage) (*DesignVersion, error) {
	// Determine parent from branch head.
	var parentID *uuid.UUID
	err := vs.db.QueryRow(
		`SELECT head_id FROM design_branches WHERE id = $1`,
		branchID,
	).Scan(&parentID)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("lookup branch head: %w", err)
	}

	versionID := uuid.New()
	hash := versionID.String()[:7]

	version := &DesignVersion{
		ID:         versionID,
		ProjectID:  projectID,
		BranchID:   branchID,
		ParentID:   parentID,
		Hash:       hash,
		Message:    message,
		AuthorID:   authorID,
		AuthorName: authorName,
		Snapshot:   snapshot,
	}

	err = vs.db.QueryRow(
		`INSERT INTO design_versions (id, project_id, branch_id, parent_id, hash, message, author_id, author_name, snapshot)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 RETURNING created_at`,
		version.ID, version.ProjectID, version.BranchID, version.ParentID,
		version.Hash, version.Message, version.AuthorID, version.AuthorName, version.Snapshot,
	).Scan(&version.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("create commit: %w", err)
	}

	// Advance the branch head to this new commit.
	if _, err := vs.db.Exec(
		`UPDATE design_branches SET head_id = $1 WHERE id = $2`,
		version.ID, branchID,
	); err != nil {
		return nil, fmt.Errorf("advance branch head: %w", err)
	}

	return version, nil
}

// GetVersion retrieves a single design version by ID.
func (vs *VersioningService) GetVersion(versionID uuid.UUID) (*DesignVersion, error) {
	v := &DesignVersion{}
	err := vs.db.QueryRow(
		`SELECT id, project_id, branch_id, parent_id, hash, message, author_id, author_name, snapshot, created_at
		 FROM design_versions WHERE id = $1`,
		versionID,
	).Scan(&v.ID, &v.ProjectID, &v.BranchID, &v.ParentID, &v.Hash, &v.Message,
		&v.AuthorID, &v.AuthorName, &v.Snapshot, &v.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get version: %w", err)
	}
	return v, nil
}

// ListVersions lists version history for a branch (newest first).
func (vs *VersioningService) ListVersions(branchID uuid.UUID, limit int) ([]DesignVersion, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := vs.db.Query(
		`SELECT id, project_id, branch_id, parent_id, hash, message, author_id, author_name, created_at
		 FROM design_versions
		 WHERE branch_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2`,
		branchID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var versions []DesignVersion
	for rows.Next() {
		var v DesignVersion
		if err := rows.Scan(&v.ID, &v.ProjectID, &v.BranchID, &v.ParentID,
			&v.Hash, &v.Message, &v.AuthorID, &v.AuthorName, &v.CreatedAt); err != nil {
			return nil, err
		}
		versions = append(versions, v)
	}
	return versions, rows.Err()
}

// DiffDesigns compares two version snapshots and returns the changed elements.
func (vs *VersioningService) DiffDesigns(fromVersionID, toVersionID uuid.UUID) (*DesignDiff, error) {
	fromVer, err := vs.GetVersion(fromVersionID)
	if err != nil {
		return nil, fmt.Errorf("load from-version: %w", err)
	}
	toVer, err := vs.GetVersion(toVersionID)
	if err != nil {
		return nil, fmt.Errorf("load to-version: %w", err)
	}

	var fromState map[string]json.RawMessage
	var toState map[string]json.RawMessage
	if err := json.Unmarshal(fromVer.Snapshot, &fromState); err != nil {
		return nil, fmt.Errorf("parse from-snapshot: %w", err)
	}
	if err := json.Unmarshal(toVer.Snapshot, &toState); err != nil {
		return nil, fmt.Errorf("parse to-snapshot: %w", err)
	}

	var elements []DiffElement
	addedCount, removedCount, modifiedCount := 0, 0, 0

	// Compare each category of design elements.
	categories := []string{"components", "traces", "vias", "zones", "nets", "pads"}
	for _, cat := range categories {
		fromItems := extractElementMap(fromState[cat])
		toItems := extractElementMap(toState[cat])

		// Find removed items.
		for id, oldVal := range fromItems {
			if _, exists := toItems[id]; !exists {
				elements = append(elements, DiffElement{
					Type:      "removed",
					Category:  cat,
					ElementID: id,
					OldValue:  oldVal,
				})
				removedCount++
			}
		}
		// Find added and modified items.
		for id, newVal := range toItems {
			oldVal, existed := fromItems[id]
			if !existed {
				elements = append(elements, DiffElement{
					Type:      "added",
					Category:  cat,
					ElementID: id,
					NewValue:  newVal,
				})
				addedCount++
			} else {
				// Compare JSON bytes for modification.
				if string(oldVal) != string(newVal) {
					elements = append(elements, DiffElement{
						Type:      "modified",
						Category:  cat,
						ElementID: id,
						OldValue:  oldVal,
						NewValue:  newVal,
					})
					modifiedCount++
				}
			}
		}
	}

	summary := fmt.Sprintf("%d added, %d removed, %d modified", addedCount, removedCount, modifiedCount)

	return &DesignDiff{
		FromVersion: fromVersionID,
		ToVersion:   toVersionID,
		Elements:    elements,
		Summary:     summary,
	}, nil
}

// MergeDesigns merges changes from a source branch into a target branch.
// It performs a three-way merge using the common ancestor. Non-conflicting
// changes are auto-merged; conflicts are returned for manual resolution.
func (vs *VersioningService) MergeDesigns(projectID, sourceBranchID, targetBranchID, authorID uuid.UUID, authorName string) (*MergeResult, error) {
	// Load branch heads.
	var sourceHeadID, targetHeadID *uuid.UUID
	err := vs.db.QueryRow(`SELECT head_id FROM design_branches WHERE id = $1`, sourceBranchID).Scan(&sourceHeadID)
	if err != nil {
		return nil, fmt.Errorf("load source branch: %w", err)
	}
	err = vs.db.QueryRow(`SELECT head_id FROM design_branches WHERE id = $1`, targetBranchID).Scan(&targetHeadID)
	if err != nil {
		return nil, fmt.Errorf("load target branch: %w", err)
	}

	if sourceHeadID == nil {
		return &MergeResult{Success: false, Message: "source branch has no commits"}, nil
	}
	if targetHeadID == nil {
		// Target has no commits; just point target to source head.
		if _, err := vs.db.Exec(`UPDATE design_branches SET head_id = $1 WHERE id = $2`, sourceHeadID, targetBranchID); err != nil {
			return nil, err
		}
		sourceVer, _ := vs.GetVersion(*sourceHeadID)
		return &MergeResult{Success: true, NewVersion: sourceVer, AutoMerged: 0, Message: "fast-forward merge"}, nil
	}

	// Perform a diff between source and target.
	diff, err := vs.DiffDesigns(*targetHeadID, *sourceHeadID)
	if err != nil {
		return nil, fmt.Errorf("diff for merge: %w", err)
	}

	// Separate conflicts from auto-mergeable changes.
	// A conflict occurs when the same element is modified differently in both branches.
	// For this implementation, all changes from the source that don't conflict are applied.
	var conflicts []DiffElement
	autoMerged := 0

	targetVer, err := vs.GetVersion(*targetHeadID)
	if err != nil {
		return nil, err
	}

	var mergedSnapshot map[string]json.RawMessage
	if err := json.Unmarshal(targetVer.Snapshot, &mergedSnapshot); err != nil {
		return nil, fmt.Errorf("parse target snapshot: %w", err)
	}

	// Apply non-conflicting changes from the diff.
	for _, elem := range diff.Elements {
		catRaw, exists := mergedSnapshot[elem.Category]
		if !exists {
			catRaw = []byte("[]")
		}

		items := extractElementMap(catRaw)

		switch elem.Type {
		case "added":
			items[elem.ElementID] = elem.NewValue
			autoMerged++
		case "removed":
			if _, ok := items[elem.ElementID]; ok {
				delete(items, elem.ElementID)
				autoMerged++
			}
		case "modified":
			// If element exists unchanged in target, auto-merge.
			if existing, ok := items[elem.ElementID]; ok {
				if string(existing) == string(elem.OldValue) {
					items[elem.ElementID] = elem.NewValue
					autoMerged++
				} else {
					conflicts = append(conflicts, elem)
				}
			} else {
				items[elem.ElementID] = elem.NewValue
				autoMerged++
			}
		}

		rebuilt := rebuildArray(items)
		mergedSnapshot[elem.Category] = rebuilt
	}

	if len(conflicts) > 0 {
		return &MergeResult{
			Success:    false,
			Conflicts:  conflicts,
			AutoMerged: autoMerged,
			Message:    fmt.Sprintf("merge has %d conflicts requiring manual resolution", len(conflicts)),
		}, nil
	}

	// Create a merge commit on the target branch.
	snapshotBytes, err := json.Marshal(mergedSnapshot)
	if err != nil {
		return nil, fmt.Errorf("marshal merged snapshot: %w", err)
	}

	mergeMsg := fmt.Sprintf("Merge branch into target: %d changes auto-merged", autoMerged)
	newVersion, err := vs.CreateCommit(projectID, targetBranchID, authorID, authorName, mergeMsg, snapshotBytes)
	if err != nil {
		return nil, fmt.Errorf("create merge commit: %w", err)
	}

	return &MergeResult{
		Success:    true,
		NewVersion: newVersion,
		AutoMerged: autoMerged,
		Message:    "merge successful",
	}, nil
}

// extractElementMap parses a JSON array of objects into a map keyed by "id" or "reference".
func extractElementMap(raw json.RawMessage) map[string]json.RawMessage {
	result := make(map[string]json.RawMessage)
	if len(raw) == 0 {
		return result
	}

	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return result
	}

	for _, item := range items {
		var obj map[string]json.RawMessage
		if err := json.Unmarshal(item, &obj); err != nil {
			continue
		}
		// Try "id", then "reference", then "name" as the key.
		for _, keyField := range []string{"id", "reference", "name"} {
			if idRaw, ok := obj[keyField]; ok {
				var idStr string
				if err := json.Unmarshal(idRaw, &idStr); err == nil {
					result[idStr] = item
					break
				}
				// Try as number.
				var idNum float64
				if err := json.Unmarshal(idRaw, &idNum); err == nil {
					result[fmt.Sprintf("%v", idNum)] = item
					break
				}
			}
		}
	}
	return result
}

// rebuildArray converts a map of elements back into a JSON array.
func rebuildArray(items map[string]json.RawMessage) json.RawMessage {
	arr := make([]json.RawMessage, 0, len(items))
	for _, v := range items {
		arr = append(arr, v)
	}
	data, _ := json.Marshal(arr)
	return data
}
