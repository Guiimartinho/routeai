package collaboration

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// CursorPosition represents a user's cursor location on the design canvas.
type CursorPosition struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Layer string  `json:"layer,omitempty"`
}

// ActiveUser tracks a user connected to a collaboration session.
type ActiveUser struct {
	UserID      uuid.UUID       `json:"user_id"`
	Name        string          `json:"name"`
	Email       string          `json:"email"`
	CursorColor string          `json:"cursor_color"`
	Cursor      *CursorPosition `json:"cursor,omitempty"`
	JoinedAt    time.Time       `json:"joined_at"`
	LastActive  time.Time       `json:"last_active"`
}

// DesignChange represents a single atomic change to the design state.
type DesignChange struct {
	ID        string          `json:"id"`
	UserID    uuid.UUID       `json:"user_id"`
	UserName  string          `json:"user_name"`
	Operation string          `json:"operation"` // "insert", "update", "delete", "move", "reparent"
	Target    string          `json:"target"`    // element type: "component", "trace", "via", "zone", "net"
	TargetID  string          `json:"target_id"`
	Data      json.RawMessage `json:"data"`
	Timestamp time.Time       `json:"timestamp"`
	Version   int64           `json:"version"`
}

// SessionEvent is sent over WebSocket to session participants.
type SessionEvent struct {
	Type    string      `json:"type"` // "user_joined", "user_left", "cursor_move", "design_change", "lock_acquired", "lock_released", "session_state"
	Payload interface{} `json:"payload"`
}

// CollabClient wraps a WebSocket connection in a collaboration context.
type CollabClient struct {
	Conn       *websocket.Conn
	UserID     uuid.UUID
	UserName   string
	Email      string
	ProjectID  uuid.UUID
	Send       chan []byte
	cursorColor string
}

// Session represents a live collaboration session for a single project.
type Session struct {
	mu          sync.RWMutex
	ProjectID   uuid.UUID
	clients     map[*CollabClient]bool
	userIndex   map[uuid.UUID]*CollabClient
	activeUsers map[uuid.UUID]*ActiveUser
	changes     []DesignChange
	version     int64
	createdAt   time.Time
}

// newSession creates a new collaboration session for a project.
func newSession(projectID uuid.UUID) *Session {
	return &Session{
		ProjectID:   projectID,
		clients:     make(map[*CollabClient]bool),
		userIndex:   make(map[uuid.UUID]*CollabClient),
		activeUsers: make(map[uuid.UUID]*ActiveUser),
		changes:     make([]DesignChange, 0),
		version:     0,
		createdAt:   time.Now().UTC(),
	}
}

// cursorColors used to assign distinct colors to collaborators.
var cursorColors = []string{
	"#ef4444", "#f97316", "#eab308", "#22c55e",
	"#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
	"#14b8a6", "#a855f7", "#f43f5e", "#84cc16",
}

func (s *Session) nextCursorColor() string {
	idx := len(s.activeUsers) % len(cursorColors)
	return cursorColors[idx]
}

// addClient registers a new collaborator in the session.
func (s *Session) addClient(client *CollabClient) {
	s.mu.Lock()
	defer s.mu.Unlock()

	color := s.nextCursorColor()
	client.cursorColor = color

	s.clients[client] = true
	s.userIndex[client.UserID] = client

	now := time.Now().UTC()
	s.activeUsers[client.UserID] = &ActiveUser{
		UserID:      client.UserID,
		Name:        client.UserName,
		Email:       client.Email,
		CursorColor: color,
		JoinedAt:    now,
		LastActive:  now,
	}
}

// removeClient removes a collaborator from the session.
func (s *Session) removeClient(client *CollabClient) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.clients, client)
	delete(s.userIndex, client.UserID)
	delete(s.activeUsers, client.UserID)
	close(client.Send)
}

// broadcast sends an event to all connected clients in the session.
func (s *Session) broadcast(event SessionEvent) {
	data, err := json.Marshal(event)
	if err != nil {
		log.Printf("collaboration: failed to marshal event: %v", err)
		return
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	for client := range s.clients {
		select {
		case client.Send <- data:
		default:
			log.Printf("collaboration: dropped event for user %s (buffer full)", client.UserID)
		}
	}
}

// broadcastExcept sends an event to all clients except the specified one.
func (s *Session) broadcastExcept(event SessionEvent, exclude *CollabClient) {
	data, err := json.Marshal(event)
	if err != nil {
		log.Printf("collaboration: failed to marshal event: %v", err)
		return
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	for client := range s.clients {
		if client == exclude {
			continue
		}
		select {
		case client.Send <- data:
		default:
			log.Printf("collaboration: dropped event for user %s (buffer full)", client.UserID)
		}
	}
}

// getActiveUsers returns a snapshot of all active users.
func (s *Session) getActiveUsers() []ActiveUser {
	s.mu.RLock()
	defer s.mu.RUnlock()

	users := make([]ActiveUser, 0, len(s.activeUsers))
	for _, u := range s.activeUsers {
		users = append(users, *u)
	}
	return users
}

// applyChange validates, timestamps, and appends a design change, then broadcasts it.
func (s *Session) applyChange(change DesignChange) DesignChange {
	s.mu.Lock()
	s.version++
	change.Version = s.version
	change.Timestamp = time.Now().UTC()
	change.ID = uuid.New().String()
	s.changes = append(s.changes, change)
	s.mu.Unlock()

	s.broadcast(SessionEvent{
		Type:    "design_change",
		Payload: change,
	})

	return change
}

// updateCursor updates a user's cursor position and notifies others.
func (s *Session) updateCursor(client *CollabClient, pos CursorPosition) {
	s.mu.Lock()
	if user, ok := s.activeUsers[client.UserID]; ok {
		user.Cursor = &pos
		user.LastActive = time.Now().UTC()
	}
	s.mu.Unlock()

	s.broadcastExcept(SessionEvent{
		Type: "cursor_move",
		Payload: map[string]interface{}{
			"user_id":      client.UserID,
			"user_name":    client.UserName,
			"cursor_color": client.cursorColor,
			"position":     pos,
		},
	}, client)
}

// CollaborationHub manages all active collaboration sessions across projects.
type CollaborationHub struct {
	mu       sync.RWMutex
	sessions map[uuid.UUID]*Session // project_id -> session
	lockMgr  *LockManager
}

// NewCollaborationHub creates a hub that manages real-time design sessions.
func NewCollaborationHub() *CollaborationHub {
	return &CollaborationHub{
		sessions: make(map[uuid.UUID]*Session),
		lockMgr:  NewLockManager(),
	}
}

// GetOrCreateSession returns the session for a project, creating one if needed.
func (h *CollaborationHub) GetOrCreateSession(projectID uuid.UUID) *Session {
	h.mu.Lock()
	defer h.mu.Unlock()

	if sess, ok := h.sessions[projectID]; ok {
		return sess
	}
	sess := newSession(projectID)
	h.sessions[projectID] = sess
	log.Printf("collaboration: created session for project %s", projectID)
	return sess
}

// GetSession returns a session if it exists.
func (h *CollaborationHub) GetSession(projectID uuid.UUID) (*Session, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	sess, ok := h.sessions[projectID]
	return sess, ok
}

// JoinSession adds a client to the project session and broadcasts a join event.
func (h *CollaborationHub) JoinSession(client *CollabClient) {
	sess := h.GetOrCreateSession(client.ProjectID)
	sess.addClient(client)

	// Notify all existing participants about the new user.
	sess.broadcast(SessionEvent{
		Type: "user_joined",
		Payload: map[string]interface{}{
			"user_id":      client.UserID,
			"user_name":    client.UserName,
			"cursor_color": client.cursorColor,
		},
	})

	// Send the new user the current session state.
	statePayload := map[string]interface{}{
		"active_users": sess.getActiveUsers(),
		"version":      sess.version,
		"locks":        h.lockMgr.ListLocks(client.ProjectID),
	}
	stateData, _ := json.Marshal(SessionEvent{
		Type:    "session_state",
		Payload: statePayload,
	})
	select {
	case client.Send <- stateData:
	default:
	}

	log.Printf("collaboration: user %s joined project %s", client.UserID, client.ProjectID)
}

// LeaveSession removes a client and broadcasts a leave event.
func (h *CollaborationHub) LeaveSession(client *CollabClient) {
	sess, ok := h.GetSession(client.ProjectID)
	if !ok {
		return
	}

	// Release any locks held by this user.
	h.lockMgr.ReleaseAllUserLocks(client.ProjectID, client.UserID)

	sess.removeClient(client)

	sess.broadcast(SessionEvent{
		Type: "user_left",
		Payload: map[string]interface{}{
			"user_id":   client.UserID,
			"user_name": client.UserName,
		},
	})

	// Clean up empty sessions.
	h.mu.Lock()
	if len(sess.clients) == 0 {
		delete(h.sessions, client.ProjectID)
		log.Printf("collaboration: removed empty session for project %s", client.ProjectID)
	}
	h.mu.Unlock()

	log.Printf("collaboration: user %s left project %s", client.UserID, client.ProjectID)
}

// HandleDesignChange processes an incoming design change from a client.
func (h *CollaborationHub) HandleDesignChange(client *CollabClient, change DesignChange) (DesignChange, error) {
	sess, ok := h.GetSession(client.ProjectID)
	if !ok {
		sess = h.GetOrCreateSession(client.ProjectID)
	}

	change.UserID = client.UserID
	change.UserName = client.UserName
	applied := sess.applyChange(change)
	return applied, nil
}

// HandleCursorMove processes a cursor position update from a client.
func (h *CollaborationHub) HandleCursorMove(client *CollabClient, pos CursorPosition) {
	sess, ok := h.GetSession(client.ProjectID)
	if !ok {
		return
	}
	sess.updateCursor(client, pos)
}

// LockManager returns the hub's lock manager for external use.
func (h *CollaborationHub) GetLockManager() *LockManager {
	return h.lockMgr
}

// ActiveSessionCount returns the number of active collaboration sessions.
func (h *CollaborationHub) ActiveSessionCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.sessions)
}

// ListActiveSessions returns project IDs with active sessions and user counts.
func (h *CollaborationHub) ListActiveSessions() map[uuid.UUID]int {
	h.mu.RLock()
	defer h.mu.RUnlock()

	result := make(map[uuid.UUID]int, len(h.sessions))
	for pid, sess := range h.sessions {
		sess.mu.RLock()
		result[pid] = len(sess.clients)
		sess.mu.RUnlock()
	}
	return result
}
