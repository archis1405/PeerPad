export interface TurnConfig {
  urls?: string;
  username?: string;
  credential?: string;
}

const DEFAULT_STUN_SERVER: RTCIceServer = { urls: 'stun:stun.l.google.com:19302' };

// STUN alone only gets two peers connected when a direct path exists at
// all (same network, or NATs that support simple hole punching) — it's
// enough for local dev and many home networks, but not for symmetric
// NATs or locked-down corporate firewalls, which is exactly the case a
// TURN relay exists to cover. `turnConfig` is empty in local dev (no
// env vars set) and populated in production by a self-hosted coturn
// instance (see the deployment notes in step 9) — this function is the
// pure decision logic for turning that config into the list WebRTC
// actually wants, kept separate from reading import.meta.env so it can
// be unit tested without mocking Vite's env.
//
// Static username/credential (rather than coturn's time-limited REST-API
// credentials) is a deliberate v1 simplification: it's the simplest thing
// that works, at the cost of a long-lived shared secret baked into the
// frontend bundle. Rotating to short-lived, per-session credentials would
// be the natural next hardening step before this carries real traffic.
export function buildIceServers(turnConfig: TurnConfig, stunServer: RTCIceServer = DEFAULT_STUN_SERVER): RTCIceServer[] {
  const servers: RTCIceServer[] = [stunServer];

  const urls = turnConfig.urls
    ?.split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  if (urls && urls.length > 0) {
    servers.push({ urls, username: turnConfig.username, credential: turnConfig.credential });
  }

  return servers;
}
