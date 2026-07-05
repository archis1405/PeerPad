// Package ws is the WebSocket transport for signaling: it upgrades HTTP
// connections, assigns each connection a peer id, and relays offer/answer/
// ICE messages between peers in the same room via the room package.
package ws

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"

	"github.com/gorilla/websocket"
	"peerpad/signaling-server/internal/room"
)

var upgrader = websocket.Upgrader{
	// This server never sees document content, only SDP/ICE handshake
	// data, and there's no per-user auth yet — so allowing any origin is
	// an acceptable v1 tradeoff. Revisit once the frontend's deployed
	// origin is known (step 9) and lock this down to it.
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Server struct {
	registry *room.Registry
}

func NewServer(registry *room.Registry) *Server {
	return &Server{registry: registry}
}

// HandleWS upgrades the request to a WebSocket and keeps it alive for the
// lifetime of the connection. The room to join is given as a query
// parameter (?room=...) rather than a "join" message, since a connection
// only ever belongs to one room for its whole lifetime — there's nothing
// to gain from making room selection a separate message round-trip.
func (s *Server) HandleWS(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("room")
	if roomID == "" {
		http.Error(w, "missing room query parameter", http.StatusBadRequest)
		return
	}

	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("upgrade failed: %v", err)
		return
	}
	defer wsConn.Close()

	c := &conn{ws: wsConn}
	peerID := generatePeerID()

	existingPeers := s.registry.Join(roomID, peerID, c)
	log.Printf("peer %s joined room %s (existing peers: %v)", peerID, roomID, existingPeers)

	c.sendEnvelope(Envelope{Type: TypeJoined, PeerID: peerID, Peers: existingPeers})
	s.broadcast(roomID, existingPeers, Envelope{Type: TypePeerJoined, PeerID: peerID})

	defer func() {
		remaining := s.registry.Leave(roomID, peerID)
		log.Printf("peer %s left room %s (remaining peers: %v)", peerID, roomID, remaining)
		s.broadcast(roomID, remaining, Envelope{Type: TypePeerLeft, PeerID: peerID})
	}()

	s.readLoop(roomID, peerID, c)
}

func (s *Server) readLoop(roomID, peerID string, c *conn) {
	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return // any read error (including a normal close) ends the connection
		}

		var env Envelope
		if err := json.Unmarshal(data, &env); err != nil {
			c.sendEnvelope(Envelope{Type: TypeError, Message: "invalid message"})
			continue
		}

		switch env.Type {
		case TypeOffer, TypeAnswer, TypeICECandidate:
			s.relay(roomID, peerID, c, env)
		default:
			c.sendEnvelope(Envelope{Type: TypeError, Message: "unknown message type: " + env.Type})
		}
	}
}

// relay forwards an offer/answer/ice-candidate to its addressed
// recipient, stamping it with the sender's peer id so the recipient knows
// who it's from. The server doesn't interpret SDP or ICE payloads at all;
// it only ever reads the envelope's routing fields (Type, To).
func (s *Server) relay(roomID, fromPeerID string, sender *conn, env Envelope) {
	if env.To == "" {
		sender.sendEnvelope(Envelope{Type: TypeError, Message: "missing 'to' field"})
		return
	}

	target, ok := s.registry.Get(roomID, env.To)
	if !ok {
		sender.sendEnvelope(Envelope{Type: TypeError, Message: "peer not found: " + env.To})
		return
	}

	env.From = fromPeerID
	env.To = ""
	payload, err := json.Marshal(env)
	if err != nil {
		log.Printf("marshal error: %v", err)
		return
	}
	target.Send(payload)
}

func (s *Server) broadcast(roomID string, peerIDs []string, env Envelope) {
	if len(peerIDs) == 0 {
		return
	}
	payload, err := json.Marshal(env)
	if err != nil {
		log.Printf("marshal error: %v", err)
		return
	}
	for _, id := range peerIDs {
		if p, ok := s.registry.Get(roomID, id); ok {
			p.Send(payload)
		}
	}
}

// generatePeerID returns a random 16-character hex id. crypto/rand is
// used (rather than, say, an incrementing counter) so ids are unguessable
// and globally unique without any coordination between rooms.
func generatePeerID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		// This only fails if the OS RNG itself is unavailable, which means
		// something is badly wrong with the host. There's no safe
		// fallback that preserves the uniqueness/unguessability this is
		// for, so fail loudly instead of handing out a weak id.
		log.Fatalf("failed to generate peer id: %v", err)
	}
	return hex.EncodeToString(buf)
}
