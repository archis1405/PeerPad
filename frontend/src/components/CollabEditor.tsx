import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CollabSession, shiftOffsetForRemoteEdits } from '../collab';
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

export function CollabEditor() {
  const [roomId, setRoomId] = useState('demo-room');
  const [connected, setConnected] = useState(false);
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const [peers, setPeers] = useState<string[]>([]);
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

  function handleConnect() {
    const signaling = new SignalingClient(SIGNALING_URL, roomId);
    const manager = new WebRTCManager(signaling);
    signalingRef.current = signaling;
    managerRef.current = manager;

    signaling.on('message', (message) => {
      if (message.type === 'joined') {
        setMyPeerId(message.peerId);
        // The peer id the signaling server assigned us doubles as this
        // document's RGA site id — it's already unique per connection,
        // so there's no reason to mint a second identifier.
        void CollabSession.create(message.peerId, manager, roomId).then((session) => {
          // If the user disconnected (or reconnected) while the room's
          // history was loading, this signaling client is no longer the
          // active one — drop the result rather than resurrect a closed
          // session.
          if (signalingRef.current !== signaling) {
            session.close();
            return;
          }
          sessionRef.current = session;
          // Seed the textarea with whatever this room's persisted history
          // (if any) replayed into the document — this is the actual
          // "restore across refresh" moment.
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
      }
    });

    manager.on('peer-connected', ({ peerId }) => {
      setPeers((prev) => (prev.includes(peerId) ? prev : [...prev, peerId]));
    });
    manager.on('peer-disconnected', ({ peerId }) => {
      setPeers((prev) => prev.filter((id) => id !== peerId));
    });

    signaling.connect();
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
    setMyPeerId(null);
    setPeers([]);
    setText('');
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newText = e.target.value;
    sessionRef.current?.applyLocalEdit(text, newText);
    setText(newText);
  }

  return (
    <div style={{ textAlign: 'left', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '1rem' }}>
        <input value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={connected} placeholder="room id" />
        {connected ? (
          <button onClick={handleDisconnect}>Disconnect</button>
        ) : (
          <button onClick={handleConnect}>Connect</button>
        )}
      </div>

      {connected && (
        <div style={{ marginBottom: '0.5rem', fontFamily: 'monospace', fontSize: '0.85rem', color: '#888' }}>
          <div>peer id: {myPeerId ?? '(connecting...)'}</div>
          <div>connected to: {peers.length ? peers.join(', ') : '(waiting for peers...)'}</div>
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
