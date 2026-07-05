import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CollabSession, shiftOffsetForRemoteEdits } from '../collab';
import { colorForId } from '../lib/presenceColor';
import { SIGNALING_URL, SignalingClient, WebRTCManager } from '../net';

// A pending cursor adjustment computed the moment a remote change
// arrives, applied to the DOM after React re-renders the textarea with
// the new text (see the useLayoutEffect below). Only remote changes set
// this — local edits leave the browser's own cursor position alone,
// since it's already exactly where the user's keystroke put it.
interface PendingSelection {
  start: number;
  end: number;
}

// A peer is "connecting" from the moment signaling tells us they're in
// the room (via `joined`'s initial roster or a later `peer-joined`) until
// their data channel actually opens. Presence intentionally reflects both
// states rather than only fully-connected peers — otherwise a slow or
// failing WebRTC handshake would look identical to nobody else being in
// the room at all.
type PresenceStatus = 'connecting' | 'connected';

export function CollabEditor() {
  const [roomId, setRoomId] = useState('demo-room');
  const [connected, setConnected] = useState(false);
  const [offline, setOffline] = useState(false);
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const [presence, setPresence] = useState<Record<string, PresenceStatus>>({});
  const [text, setText] = useState('');

  const signalingRef = useRef<SignalingClient | null>(null);
  const managerRef = useRef<WebRTCManager | null>(null);
  const sessionRef = useRef<CollabSession | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelectionRef = useRef<PendingSelection | null>(null);

  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current;
    const textarea = textareaRef.current;
    if (pending && textarea) {
      textarea.selectionStart = pending.start;
      textarea.selectionEnd = pending.end;
    }
    pendingSelectionRef.current = null;
  }, [text]);

  useEffect(() => {
    return () => {
      managerRef.current?.close();
      signalingRef.current?.close();
      sessionRef.current?.close();
    };
  }, []);

  // Opens a signaling + WebRTC connection for `roomId`. Used both for the
  // very first connect and for coming back online after "simulate
  // offline": if a session from a previous connection is still around
  // (sessionRef.current is only ever cleared by a full Disconnect), it's
  // rebound to the fresh manager instead of being recreated — the
  // in-memory document (and anything typed while offline) carries over
  // untouched.
  function connectNetwork() {
    const signaling = new SignalingClient(SIGNALING_URL, roomId);
    const manager = new WebRTCManager(signaling);
    signalingRef.current = signaling;
    managerRef.current = manager;

    signaling.on('message', (message) => {
      if (message.type === 'peer-joined') {
        setPresence((prev) => ({ ...prev, [message.peerId]: 'connecting' }));
        return;
      }
      if (message.type !== 'joined') return;

      setMyPeerId(message.peerId);
      setPresence(Object.fromEntries((message.peers ?? []).map((peerId) => [peerId, 'connecting'])));

      if (sessionRef.current) {
        sessionRef.current.rebind(manager);
        return;
      }

      // The peer id the signaling server assigned us doubles as this
      // document's RGA site id — it's already unique per connection, so
      // there's no reason to mint a second identifier.
      void CollabSession.create(message.peerId, manager, roomId).then((session) => {
        if (signalingRef.current !== signaling) {
          // Disconnected before history finished loading; drop the result
          // rather than resurrect a closed session.
          session.close();
          return;
        }
        sessionRef.current = session;
        // Seed the textarea with whatever this room's persisted history
        // (if any) replayed into the document — the "restore across
        // refresh" moment from step 6.
        setText(session.doc.toText());
        session.on('change', ({ text: newText, remoteEdits }) => {
          if (remoteEdits.length > 0) {
            const textarea = textareaRef.current;
            if (textarea && document.activeElement === textarea) {
              pendingSelectionRef.current = {
                start: shiftOffsetForRemoteEdits(textarea.selectionStart, remoteEdits),
                end: shiftOffsetForRemoteEdits(textarea.selectionEnd, remoteEdits),
              };
            }
          }
          setText(newText);
        });
      });
    });

    manager.on('peer-connected', ({ peerId }) => {
      setPresence((prev) => ({ ...prev, [peerId]: 'connected' }));
    });
    manager.on('peer-disconnected', ({ peerId }) => {
      setPresence((prev) => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
    });

    signaling.connect();
  }

  function handleConnect() {
    connectNetwork();
    setConnected(true);
  }

  function handleDisconnect() {
    sessionRef.current?.close();
    managerRef.current?.close();
    signalingRef.current?.close();
    sessionRef.current = null;
    managerRef.current = null;
    signalingRef.current = null;
    setConnected(false);
    setOffline(false);
    setMyPeerId(null);
    setPresence({});
    setText('');
  }

  // Tears down networking only — the CollabSession (and its RGADocument)
  // is left running. applyLocalEdit still works while offline: edits are
  // applied to the document and persisted to IndexedDB exactly as
  // before; manager.broadcast() on a manager with no connected peers is
  // simply a no-op, so nothing errors, the ops just aren't delivered
  // anywhere until handleGoOnline reconnects.
  function handleGoOffline() {
    managerRef.current?.close();
    signalingRef.current?.close();
    managerRef.current = null;
    signalingRef.current = null;
    setPresence({});
    setOffline(true);
  }

  function handleGoOnline() {
    connectNetwork();
    setOffline(false);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newText = e.target.value;
    sessionRef.current?.applyLocalEdit(text, newText);
    setText(newText);
  }

  const peerIds = Object.keys(presence);

  return (
    <div style={{ textAlign: 'left', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '1rem' }}>
        <input value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={connected} placeholder="room id" />
        {connected ? (
          <button onClick={handleDisconnect}>Disconnect</button>
        ) : (
          <button onClick={handleConnect}>Connect</button>
        )}
        {connected && (
          <button onClick={offline ? handleGoOnline : handleGoOffline}>
            {offline ? 'Go back online' : 'Simulate offline'}
          </button>
        )}
      </div>

      {connected && (
        <div style={{ marginBottom: '0.75rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>
          <div style={{ color: '#888', marginBottom: '0.4rem' }}>
            status:{' '}
            {offline ? (
              <strong style={{ color: '#c00' }}>OFFLINE — edits are local only until you go back online</strong>
            ) : (
              'online'
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {myPeerId && (
              <PresenceRow id={myPeerId} label={`${myPeerId} (you)`} status="connected" />
            )}
            {peerIds.length === 0 && <span style={{ color: '#888' }}>(waiting for peers...)</span>}
            {peerIds.map((peerId) => (
              <PresenceRow key={peerId} id={peerId} label={peerId} status={presence[peerId]} />
            ))}
          </div>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        disabled={!connected}
        rows={16}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: '1rem', padding: '0.5rem' }}
        placeholder={connected ? 'Start typing...' : 'Connect to a room to start editing'}
      />
    </div>
  );
}

function PresenceRow({ id, label, status }: { id: string; label: string; status: PresenceStatus }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <span
        style={{
          display: 'inline-block',
          width: '0.6rem',
          height: '0.6rem',
          borderRadius: '50%',
          background: colorForId(id),
          opacity: status === 'connected' ? 1 : 0.4,
        }}
      />
      <span>{label}</span>
      {status === 'connecting' && <span style={{ color: '#888' }}>(connecting...)</span>}
    </div>
  );
}
