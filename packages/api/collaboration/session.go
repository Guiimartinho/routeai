package collaboration

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

// ComponentLock represents a lock on a specific design region or component.
type ComponentLock struct {
	ID         string    `json:"id"`
	ProjectID  uuid.UUID `json:"project_id"`
	UserID     uuid.UUID `json:"user_id"`
	UserName   string    `json:"user_name"`
	TargetType string    `json:"target_type"` // "component", "region", "net", "zone"
	TargetID   string    `json:"target_id"`   // specific component ref or region identifier
	AcquiredAt time.Time `json:"acquired_at"`
	ExpiresAt  time.Time `json:"expires_at"`
}

// LockManager provides mutex-style locking for design elements during
// collaborative editing. When a user locks a region, other users cannot
// modify it until the lock is released or expires.
type LockManager struct {
	mu    sync.RWMutex
	locks map[string]*ComponentLock // key: "projectID:targetType:targetID"
}

// NewLockManager creates a lock manager for collaborative edit sessions.
func NewLockManager() *LockManager {
	mgr := &LockManager{
		locks: make(map[string]*ComponentLock),
	}
	// Start background goroutine to expire stale locks.
	go mgr.expirationLoop()
	return mgr
}

func lockKey(projectID uuid.UUID, targetType, targetID string) string {
	return fmt.Sprintf("%s:%s:%s", projectID, targetType, targetID)
}

// AcquireLock attempts to lock a design element for the given user.
// Returns the lock if successful, or an error if already locked by another user.
func (m *LockManager) AcquireLock(projectID, userID uuid.UUID, userName, targetType, targetID string, durationSeconds int) (*ComponentLock, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := lockKey(projectID, targetType, targetID)
	now := time.Now().UTC()

	if existing, ok := m.locks[key]; ok {
		// If expired, remove it.
		if now.After(existing.ExpiresAt) {
			delete(m.locks, key)
		} else if existing.UserID != userID {
			return nil, fmt.Errorf("element %s:%s is locked by %s until %s",
				targetType, targetID, existing.UserName, existing.ExpiresAt.Format(time.RFC3339))
		} else {
			// Same user re-acquiring: extend.
			existing.ExpiresAt = now.Add(time.Duration(durationSeconds) * time.Second)
			return existing, nil
		}
	}

	if durationSeconds <= 0 {
		durationSeconds = 300 // Default 5-minute lock duration.
	}

	lock := &ComponentLock{
		ID:         uuid.New().String(),
		ProjectID:  projectID,
		UserID:     userID,
		UserName:   userName,
		TargetType: targetType,
		TargetID:   targetID,
		AcquiredAt: now,
		ExpiresAt:  now.Add(time.Duration(durationSeconds) * time.Second),
	}
	m.locks[key] = lock
	return lock, nil
}

// ReleaseLock releases a lock held by the given user.
func (m *LockManager) ReleaseLock(projectID, userID uuid.UUID, targetType, targetID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := lockKey(projectID, targetType, targetID)
	existing, ok := m.locks[key]
	if !ok {
		return nil // No lock to release.
	}
	if existing.UserID != userID {
		return fmt.Errorf("lock on %s:%s is held by a different user", targetType, targetID)
	}
	delete(m.locks, key)
	return nil
}

// ReleaseAllUserLocks releases all locks held by a specific user in a project.
func (m *LockManager) ReleaseAllUserLocks(projectID, userID uuid.UUID) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for key, lock := range m.locks {
		if lock.ProjectID == projectID && lock.UserID == userID {
			delete(m.locks, key)
		}
	}
}

// IsLocked checks whether a design element is currently locked.
func (m *LockManager) IsLocked(projectID uuid.UUID, targetType, targetID string) (*ComponentLock, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	key := lockKey(projectID, targetType, targetID)
	lock, ok := m.locks[key]
	if !ok {
		return nil, false
	}
	if time.Now().UTC().After(lock.ExpiresAt) {
		return nil, false
	}
	return lock, true
}

// ListLocks returns all active locks for a project.
func (m *LockManager) ListLocks(projectID uuid.UUID) []ComponentLock {
	m.mu.RLock()
	defer m.mu.RUnlock()

	now := time.Now().UTC()
	var result []ComponentLock
	for _, lock := range m.locks {
		if lock.ProjectID == projectID && now.Before(lock.ExpiresAt) {
			result = append(result, *lock)
		}
	}
	return result
}

// expirationLoop periodically removes expired locks.
func (m *LockManager) expirationLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		m.mu.Lock()
		now := time.Now().UTC()
		for key, lock := range m.locks {
			if now.After(lock.ExpiresAt) {
				delete(m.locks, key)
			}
		}
		m.mu.Unlock()
	}
}

// ChangeTracker records all design changes with user attribution for a session.
// It supports replaying changes and building a timeline of who changed what.
type ChangeTracker struct {
	mu      sync.RWMutex
	entries []TrackedChange
}

// TrackedChange is a change entry with full attribution metadata.
type TrackedChange struct {
	ID          string          `json:"id"`
	UserID      uuid.UUID       `json:"user_id"`
	UserName    string          `json:"user_name"`
	Operation   string          `json:"operation"`
	TargetType  string          `json:"target_type"`
	TargetID    string          `json:"target_id"`
	PrevState   json.RawMessage `json:"prev_state,omitempty"`
	NewState    json.RawMessage `json:"new_state"`
	Timestamp   time.Time       `json:"timestamp"`
	SessionID   string          `json:"session_id"`
	MergedFrom  string          `json:"merged_from,omitempty"` // Set when this change came from a lock release merge.
}

// NewChangeTracker creates a new change tracker.
func NewChangeTracker() *ChangeTracker {
	return &ChangeTracker{
		entries: make([]TrackedChange, 0, 256),
	}
}

// Record adds a new tracked change.
func (ct *ChangeTracker) Record(change TrackedChange) {
	ct.mu.Lock()
	defer ct.mu.Unlock()

	change.ID = uuid.New().String()
	change.Timestamp = time.Now().UTC()
	ct.entries = append(ct.entries, change)
}

// ListChanges returns changes since a given timestamp.
func (ct *ChangeTracker) ListChanges(since time.Time) []TrackedChange {
	ct.mu.RLock()
	defer ct.mu.RUnlock()

	var result []TrackedChange
	for _, e := range ct.entries {
		if e.Timestamp.After(since) {
			result = append(result, e)
		}
	}
	return result
}

// ListChangesByUser returns all changes attributed to a specific user.
func (ct *ChangeTracker) ListChangesByUser(userID uuid.UUID) []TrackedChange {
	ct.mu.RLock()
	defer ct.mu.RUnlock()

	var result []TrackedChange
	for _, e := range ct.entries {
		if e.UserID == userID {
			result = append(result, e)
		}
	}
	return result
}

// MergeChangesOnUnlock processes changes that were made under a lock. When
// the lock is released the buffered changes are attributed as a merge and
// applied to the canonical change stream.
func (ct *ChangeTracker) MergeChangesOnUnlock(lockID string, changes []TrackedChange) {
	ct.mu.Lock()
	defer ct.mu.Unlock()

	for _, ch := range changes {
		ch.MergedFrom = lockID
		ch.Timestamp = time.Now().UTC()
		ch.ID = uuid.New().String()
		ct.entries = append(ct.entries, ch)
	}
}

// Count returns the total number of tracked changes.
func (ct *ChangeTracker) Count() int {
	ct.mu.RLock()
	defer ct.mu.RUnlock()
	return len(ct.entries)
}
