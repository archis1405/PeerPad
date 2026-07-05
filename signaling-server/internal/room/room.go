// Package room tracks which peers are currently in which signaling rooms.
// It knows nothing about WebSockets or WebRTC — it just maps room IDs to
// sets of peers, so it can be tested and reasoned about independently of
// the network transport.
package room

import "sync"

// Peer is anything that can receive a relayed message. The ws package
// implements this over a websocket connection; keeping it as an interface
// here means this package has zero dependency on websockets.
type Peer interface {
	Send(message []byte)
}

// Registry tracks room membership. A room is just a map of peer ID -> Peer,
// created the moment its first peer joins and deleted the moment its last
// peer leaves — there's no persistence and nothing to garbage-collect
// later, which is the whole point of not needing a database for v1.
//
// Everything goes through the single mutex below rather than a per-room
// lock. Signaling traffic (join/leave/offer/answer/ICE) is low-volume
// compared to what actually flows over the resulting data channels, so
// there's no throughput reason to complicate the locking — one mutex is
// easier to reason about and to verify free of deadlocks.
type Registry struct {
	mu    sync.Mutex
	rooms map[string]map[string]Peer // roomID -> peerID -> Peer
}

func NewRegistry() *Registry {
	return &Registry{rooms: make(map[string]map[string]Peer)}
}

// Join adds peerID to roomID, creating the room if this is its first
// member, and returns the IDs of peers that were already in the room
// (i.e. everyone the new peer will need to start a WebRTC handshake with).
func (reg *Registry) Join(roomID, peerID string, p Peer) []string {
	reg.mu.Lock()
	defer reg.mu.Unlock()

	peers, ok := reg.rooms[roomID]
	if !ok {
		peers = make(map[string]Peer)
		reg.rooms[roomID] = peers
	}

	existing := make([]string, 0, len(peers))
	for id := range peers {
		existing = append(existing, id)
	}

	peers[peerID] = p
	return existing
}

// Leave removes peerID from roomID. If that was the last peer in the room,
// the room itself is deleted. It returns the IDs of peers still remaining
// (so the caller can notify them), or nil if the room is now gone.
func (reg *Registry) Leave(roomID, peerID string) []string {
	reg.mu.Lock()
	defer reg.mu.Unlock()

	peers, ok := reg.rooms[roomID]
	if !ok {
		return nil
	}

	delete(peers, peerID)
	if len(peers) == 0 {
		delete(reg.rooms, roomID)
		return nil
	}

	remaining := make([]string, 0, len(peers))
	for id := range peers {
		remaining = append(remaining, id)
	}
	return remaining
}

// Get looks up a single peer within a room, used to relay a targeted
// message (offer/answer/ice-candidate) to its intended recipient.
func (reg *Registry) Get(roomID, peerID string) (Peer, bool) {
	reg.mu.Lock()
	defer reg.mu.Unlock()

	peers, ok := reg.rooms[roomID]
	if !ok {
		return nil, false
	}
	p, ok := peers[peerID]
	return p, ok
}
