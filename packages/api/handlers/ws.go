package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	jwtPkg "github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"routeai/api/middleware"
	"routeai/api/models"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins in development; restrict in production.
	},
}

// WSMessage represents a WebSocket message.
type WSMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

// Client represents a single WebSocket connection.
type Client struct {
	Hub    *Hub
	Conn   *websocket.Conn
	UserID uuid.UUID
	Send   chan []byte
}

// Hub maintains the set of active clients and broadcasts messages.
type Hub struct {
	mu         sync.RWMutex
	clients    map[*Client]bool
	userIndex  map[uuid.UUID]map[*Client]bool
	register   chan *Client
	unregister chan *Client
}

// NewHub creates a new Hub instance.
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		userIndex:  make(map[uuid.UUID]map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

// Run starts the hub's event loop. Should be called as a goroutine.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			if h.userIndex[client.UserID] == nil {
				h.userIndex[client.UserID] = make(map[*Client]bool)
			}
			h.userIndex[client.UserID][client] = true
			h.mu.Unlock()
			log.Printf("WebSocket client connected: user=%s", client.UserID)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				if userClients, ok := h.userIndex[client.UserID]; ok {
					delete(userClients, client)
					if len(userClients) == 0 {
						delete(h.userIndex, client.UserID)
					}
				}
				close(client.Send)
			}
			h.mu.Unlock()
			log.Printf("WebSocket client disconnected: user=%s", client.UserID)
		}
	}
}

// SendToUser sends a message to all connections for a specific user.
func (h *Hub) SendToUser(userID uuid.UUID, msg WSMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Failed to marshal WS message: %v", err)
		return
	}

	h.mu.RLock()
	clients := h.userIndex[userID]
	h.mu.RUnlock()

	for client := range clients {
		select {
		case client.Send <- data:
		default:
			// Client buffer full, drop the message.
			log.Printf("Dropped message for user %s: buffer full", userID)
		}
	}
}

// Broadcast sends a message to all connected clients.
func (h *Hub) Broadcast(msg WSMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Failed to marshal WS message: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		select {
		case client.Send <- data:
		default:
			log.Printf("Dropped broadcast message for user %s", client.UserID)
		}
	}
}

// HandleWebSocket handles GET /api/v1/ws - upgrades to WebSocket.
// Accepts auth token via Authorization header (standard middleware) or
// via query parameter ?token=... (since WebSocket API doesn't support
// custom headers from browsers).
func HandleWebSocket(hub *Hub, jwtSecret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		// First try to get user ID from middleware (Authorization header).
		userID, ok := middleware.GetUserID(c)
		if !ok {
			// Fall back to token from query parameter.
			tokenStr := c.Query("token")
			if tokenStr == "" {
				c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
				return
			}
			claims := &middleware.Claims{}
			token, err := jwtPkg.ParseWithClaims(tokenStr, claims, func(token *jwtPkg.Token) (interface{}, error) {
				if _, ok := token.Method.(*jwtPkg.SigningMethodHMAC); !ok {
					return nil, jwtPkg.ErrSignatureInvalid
				}
				return []byte(jwtSecret), nil
			})
			if err != nil || !token.Valid {
				c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "invalid or expired token"})
				return
			}
			userID = claims.UserID
			ok = true
		}
		if !ok {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
			return
		}

		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Printf("WebSocket upgrade failed: %v", err)
			return
		}

		client := &Client{
			Hub:    hub,
			Conn:   conn,
			UserID: userID,
			Send:   make(chan []byte, 256),
		}

		hub.register <- client

		go client.writePump()
		go client.readPump()
	}
}

// readPump reads messages from the WebSocket connection.
func (c *Client) readPump() {
	defer func() {
		c.Hub.unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(4096)
	c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("WebSocket read error: %v", err)
			}
			break
		}

		// Handle incoming messages from client (e.g., ping, subscribe).
		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "ping":
			reply, _ := json.Marshal(WSMessage{Type: "pong", Payload: nil})
			select {
			case c.Send <- reply:
			default:
			}
		}
	}
}

// writePump writes messages to the WebSocket connection.
func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				// Hub closed the channel.
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Drain any queued messages into the current write.
			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte("\n"))
				w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
