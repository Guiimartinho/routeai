package handlers

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestNewHub(t *testing.T) {
	hub := NewHub()
	if hub == nil {
		t.Fatal("NewHub returned nil")
	}
	if hub.clients == nil {
		t.Error("clients map should be initialized")
	}
	if hub.userIndex == nil {
		t.Error("userIndex map should be initialized")
	}
}

func TestHub_RegisterAndUnregister(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	userID := uuid.New()
	client := &Client{
		Hub:    hub,
		UserID: userID,
		Send:   make(chan []byte, 256),
	}

	// Register.
	hub.register <- client
	time.Sleep(50 * time.Millisecond)

	hub.mu.RLock()
	if !hub.clients[client] {
		t.Error("client should be registered")
	}
	if _, ok := hub.userIndex[userID]; !ok {
		t.Error("user should be in userIndex")
	}
	hub.mu.RUnlock()

	// Unregister.
	hub.unregister <- client
	time.Sleep(50 * time.Millisecond)

	hub.mu.RLock()
	if hub.clients[client] {
		t.Error("client should be unregistered")
	}
	if _, ok := hub.userIndex[userID]; ok {
		t.Error("user should be removed from userIndex when no clients remain")
	}
	hub.mu.RUnlock()
}

func TestHub_SendToUser(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	userID := uuid.New()
	client := &Client{
		Hub:    hub,
		UserID: userID,
		Send:   make(chan []byte, 256),
	}

	hub.register <- client
	time.Sleep(50 * time.Millisecond)

	msg := WSMessage{
		Type:    "review_progress",
		Payload: map[string]interface{}{"status": "running"},
	}

	hub.SendToUser(userID, msg)

	select {
	case data := <-client.Send:
		var received WSMessage
		if err := json.Unmarshal(data, &received); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}
		if received.Type != "review_progress" {
			t.Errorf("expected type=review_progress, got %s", received.Type)
		}
	case <-time.After(1 * time.Second):
		t.Error("expected message on Send channel")
	}

	hub.unregister <- client
}

func TestHub_Broadcast(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	clients := make([]*Client, 3)
	for i := 0; i < 3; i++ {
		clients[i] = &Client{
			Hub:    hub,
			UserID: uuid.New(),
			Send:   make(chan []byte, 256),
		}
		hub.register <- clients[i]
	}
	time.Sleep(50 * time.Millisecond)

	msg := WSMessage{Type: "system_alert", Payload: "test"}
	hub.Broadcast(msg)

	for i, client := range clients {
		select {
		case data := <-client.Send:
			var received WSMessage
			json.Unmarshal(data, &received)
			if received.Type != "system_alert" {
				t.Errorf("client %d: expected type=system_alert, got %s", i, received.Type)
			}
		case <-time.After(1 * time.Second):
			t.Errorf("client %d: expected message", i)
		}
		hub.unregister <- client
	}
}

func TestHub_SendToUser_NoSuchUser(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	// Should not panic when sending to non-existent user.
	msg := WSMessage{Type: "test", Payload: nil}
	hub.SendToUser(uuid.New(), msg)
}

func TestHub_MultipleClientsPerUser(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	userID := uuid.New()
	client1 := &Client{Hub: hub, UserID: userID, Send: make(chan []byte, 256)}
	client2 := &Client{Hub: hub, UserID: userID, Send: make(chan []byte, 256)}

	hub.register <- client1
	hub.register <- client2
	time.Sleep(50 * time.Millisecond)

	msg := WSMessage{Type: "update", Payload: "data"}
	hub.SendToUser(userID, msg)

	// Both clients should receive the message.
	for i, client := range []*Client{client1, client2} {
		select {
		case <-client.Send:
			// OK
		case <-time.After(1 * time.Second):
			t.Errorf("client %d should receive message", i)
		}
	}

	// Unregister one, other should still get messages.
	hub.unregister <- client1
	time.Sleep(50 * time.Millisecond)

	hub.SendToUser(userID, msg)
	select {
	case <-client2.Send:
		// OK
	case <-time.After(1 * time.Second):
		t.Error("client2 should still receive messages")
	}

	hub.unregister <- client2
}

func TestWSMessage_JSON(t *testing.T) {
	msg := WSMessage{
		Type:    "chat_reply",
		Payload: map[string]string{"content": "Hello"},
	}

	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded WSMessage
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if decoded.Type != "chat_reply" {
		t.Errorf("expected type=chat_reply, got %s", decoded.Type)
	}
}
