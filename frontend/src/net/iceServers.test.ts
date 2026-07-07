import { describe, expect, it } from 'vitest';
import { buildIceServers } from './iceServers';

const STUN: RTCIceServer = { urls: 'stun:example.test:19302' };

describe('buildIceServers', () => {
  it('returns only the STUN server when no TURN config is provided', () => {
    expect(buildIceServers({}, STUN)).toEqual([STUN]);
  });

  it('treats an empty urls string as "not configured"', () => {
    expect(buildIceServers({ urls: '', username: 'u', credential: 'c' }, STUN)).toEqual([STUN]);
  });

  it('treats a whitespace-only urls string as "not configured"', () => {
    expect(buildIceServers({ urls: '   ' }, STUN)).toEqual([STUN]);
  });

  it('adds a TURN server alongside STUN when configured', () => {
    const result = buildIceServers(
      { urls: 'turn:example.test:3478', username: 'alice', credential: 'secret' },
      STUN,
    );
    expect(result).toEqual([STUN, { urls: ['turn:example.test:3478'], username: 'alice', credential: 'secret' }]);
  });

  it('splits and trims multiple comma-separated TURN urls', () => {
    const result = buildIceServers(
      { urls: 'turn:example.test:3478?transport=udp, turn:example.test:3478?transport=tcp ,turns:example.test:5349?transport=tcp' },
      STUN,
    );
    expect(result[1]).toEqual({
      urls: [
        'turn:example.test:3478?transport=udp',
        'turn:example.test:3478?transport=tcp',
        'turns:example.test:5349?transport=tcp',
      ],
      username: undefined,
      credential: undefined,
    });
  });
});
