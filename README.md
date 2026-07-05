# PeerPad

A peer-to-peer collaborative text editor. No central server holds document
state — peers connect directly over WebRTC and merge edits using a hand-rolled
RGA (Replicated Growable Array) CRDT. A small Go signaling server exists only
to help peers find each other and exchange WebRTC connection info; it never
sees document content.

## Structure

- `frontend/` — Vite + React + TypeScript client. The CRDT, WebRTC transport,
  and IndexedDB persistence all live here.
- `signaling-server/` — Go WebSocket server that relays SDP offers/answers and
  ICE candidates between peers in the same room.

## Status

Project scaffolding only. See commit history for feature-by-feature progress.

## Development

Frontend:

```sh
cd frontend
npm install
npm run dev
```

Signaling server:

```sh
cd signaling-server
go run ./cmd/server
```
