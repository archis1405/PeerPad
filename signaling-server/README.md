# PeerPad signaling server

A minimal WebSocket server whose only job is to help two browser peers find
each other and exchange the WebRTC handshake data (SDP offers/answers, ICE
candidates) needed to open a direct peer-to-peer `RTCDataChannel`. Once that
data channel is up, this server is no longer involved — it never sees
document content, and it holds no state beyond "who is currently connected
to which room" (an in-memory, mutex-guarded map; nothing is persisted).

## Connecting

```
GET ws://<host>/ws?room=<roomId>
```

`room` is any string the frontend chooses (e.g. a URL slug). There's no
separate "join" message — connecting to this endpoint *is* joining the
room, and the room a connection belongs to never changes for the lifetime
of that connection. The server assigns a random peer id (16 hex chars) to
each connection; peer ids are not reused and carry no meaning beyond
identifying a specific connection.

Health check: `GET /healthz` returns `200 ok`.

## Message envelope

Every message, in both directions, is a single JSON object with this
shape (fields not used by a given message type are simply absent):

```ts
{
  type: string,          // one of the message types below
  peerId?: string,       // present on "joined" / "peer-joined" / "peer-left"
  peers?: string[],      // present on "joined" only
  to?: string,           // set by the client on outgoing offer/answer/ice-candidate
  from?: string,         // set by the server on relayed offer/answer/ice-candidate
  sdp?: object,           // present on offer/answer — opaque to the server
  candidate?: object,     // present on ice-candidate — opaque to the server
  message?: string,       // present on "error"
}
```

The server never inspects `sdp` or `candidate` beyond relaying them
verbatim — it only ever reads `type` and `to` for routing.

## Message types

### `joined` (server → new client, once, right after connecting)

Sent immediately after a successful upgrade, telling the new client its
assigned id and who else is already in the room.

```json
{ "type": "joined", "peerId": "a58d3e7d1e784cbb", "peers": ["0d162c6af6f5c832"] }
```

The client is expected to initiate an offer to each id in `peers` (or wait
for `peer-joined` to know when to do so for peers that join later).

### `peer-joined` (server → existing peers in the room)

Broadcast to everyone already in the room when a new peer connects.

```json
{ "type": "peer-joined", "peerId": "0d162c6af6f5c832" }
```

### `peer-left` (server → remaining peers in the room)

Broadcast when a peer disconnects (clean close, network drop, or tab
close — the server can't tell these apart and doesn't need to). Frontend
code should tear down the corresponding `RTCPeerConnection`.

```json
{ "type": "peer-left", "peerId": "0d162c6af6f5c832" }
```

### `offer` / `answer` (client → server → target client)

Sent by a client to relay an `RTCSessionDescription` to a specific peer.
The client sets `to`; the server strips it and stamps `from` with the
sender's id before forwarding.

Client sends:

```json
{ "type": "offer", "to": "0d162c6af6f5c832", "sdp": { "type": "offer", "sdp": "v=0..." } }
```

Recipient receives:

```json
{ "type": "offer", "from": "a58d3e7d1e784cbb", "sdp": { "type": "offer", "sdp": "v=0..." } }
```

`answer` behaves identically with `"type": "answer"`.

### `ice-candidate` (client → server → target client)

Relays a single `RTCIceCandidate`. Same `to`/`from` addressing as
offer/answer.

```json
{ "type": "ice-candidate", "to": "0d162c6af6f5c832", "candidate": { "candidate": "...", "sdpMid": "0", "sdpMLineIndex": 0 } }
```

### `error` (server → client)

Sent back to the client that caused it — never broadcast. Currently
generated for: malformed JSON, an unrecognized `type`, a relay message
missing `to`, or a relay message whose `to` doesn't match anyone currently
in the room (e.g. they already disconnected).

```json
{ "type": "error", "message": "peer not found: 0d162c6af6f5c832" }
```

## Design notes

- **Two peers or many**: the protocol is addressed (`to`/`from`), not
  broadcast-only, so a room isn't hardcoded to exactly two participants —
  a third peer can join the same room and offer/answer with each existing
  peer individually. v1's frontend only exercises the two-peer case.
- **No persistence**: `internal/room.Registry` is an in-memory
  `map[roomID]map[peerID]Peer` behind a single mutex. A room is created on
  its first joiner and deleted the moment its last member leaves — there's
  nothing to clean up on a timer and nothing to survive a server restart
  (which is fine: signaling state is only ever needed to bootstrap a data
  channel, not to keep one alive).
- **Origin checking is wide open** (`CheckOrigin` always returns `true`).
  Acceptable for now since there's no auth and no sensitive data crosses
  this server; revisit once the frontend's production origin is fixed.

## Development

```sh
go run ./cmd/server
```

Runs on `:8080`.
