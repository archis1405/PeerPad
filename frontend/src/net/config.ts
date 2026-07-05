import { buildIceServers } from './iceServers';

// VITE_SIGNALING_URL lets deployment point at a real server (step 9);
// falls back to the local Go server for dev.
export const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL ?? 'ws://localhost:8080/ws';

// Unset in local dev (no coturn to point at); populated in production
// with a self-hosted coturn instance's details. See buildIceServers for
// why STUN alone isn't enough for every network, and why a TURN server
// is additive rather than a replacement for it.
export const ICE_SERVERS: RTCIceServer[] = buildIceServers({
  urls: import.meta.env.VITE_TURN_URLS,
  username: import.meta.env.VITE_TURN_USERNAME,
  credential: import.meta.env.VITE_TURN_CREDENTIAL,
});
