package ws

import (
	"encoding/json"
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

// conn wraps a websocket connection and implements room.Peer. It exists
// mainly to add a write mutex: gorilla's *websocket.Conn does not support
// concurrent writes from multiple goroutines, but multiple other peers'
// read loops can all try to relay a message to this same connection at
// once, so every outbound write has to go through this lock.
type conn struct {
	ws *websocket.Conn
	mu sync.Mutex
}

func (c *conn) Send(message []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.ws.WriteMessage(websocket.TextMessage, message); err != nil {
		log.Printf("write error: %v", err)
	}
}

func (c *conn) sendEnvelope(env Envelope) {
	payload, err := json.Marshal(env)
	if err != nil {
		log.Printf("marshal error: %v", err)
		return
	}
	c.Send(payload)
}
