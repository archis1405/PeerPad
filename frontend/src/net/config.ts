// VITE_SIGNALING_URL lets deployment point at a real server (step 9);
// falls back to the local Go server for dev.
export const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL ?? 'ws://localhost:8080/ws';

// A public STUN server is enough for two peers to discover their
// reflexive (public-facing) addresses, which is all that's needed when
// both browsers can reach each other without a relay (e.g. same network,
// or NATs that support simple hole punching). It is not enough on its
// own for every network topology — symmetric NATs need a TURN relay,
// which step 8 adds alongside a self-hosted coturn instance.
export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
