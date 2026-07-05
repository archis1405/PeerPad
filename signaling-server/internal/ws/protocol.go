package ws

import "encoding/json"

// Message types. See the package README for the full protocol writeup —
// this is just the wire vocabulary.
const (
	TypeJoined       = "joined"        // server -> new client, right after connecting
	TypePeerJoined   = "peer-joined"   // server -> existing clients, when someone new joins
	TypePeerLeft     = "peer-left"     // server -> remaining clients, when someone disconnects
	TypeOffer        = "offer"         // client -> client, relayed as-is
	TypeAnswer       = "answer"        // client -> client, relayed as-is
	TypeICECandidate = "ice-candidate" // client -> client, relayed as-is
	TypeError        = "error"         // server -> client, something went wrong
)

// Envelope is the single JSON shape used for every message in both
// directions. Not every field applies to every type; `omitempty` keeps
// the wire format free of nulls for fields a given message doesn't use.
//
// SDP and Candidate are left as json.RawMessage on purpose: this server
// relays WebRTC signaling data, it doesn't need to understand it. Keeping
// it opaque means the Go server never has to change if the shape of an
// SDP or ICE candidate payload evolves on the browser side.
type Envelope struct {
	Type      string          `json:"type"`
	PeerID    string          `json:"peerId,omitempty"`
	Peers     []string        `json:"peers,omitempty"`
	To        string          `json:"to,omitempty"`
	From      string          `json:"from,omitempty"`
	SDP       json.RawMessage `json:"sdp,omitempty"`
	Candidate json.RawMessage `json:"candidate,omitempty"`
	Message   string          `json:"message,omitempty"`
}
