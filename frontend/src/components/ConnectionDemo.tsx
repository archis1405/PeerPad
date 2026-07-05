import { useEffect, useRef, useState } from 'react';
import { SIGNALING_URL, SignalingClient, WebRTCManager } from '../net';

interface LogEntry {
  id: number;
  text: string;
}

let nextLogId = 0;

// Manual test harness for step 4: proves a real RTCDataChannel comes up
// between two browser tabs via the Go signaling server. This is
// deliberately not the editor UI (that's step 5) — it's raw connection
// plumbing with a text box, so the WebRTC wiring can be verified on its
// own before the CRDT is wired into it.
export function ConnectionDemo() {
  const [roomId, setRoomId] = useState('demo-room');
  const [connected, setConnected] = useState(false);
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const [peers, setPeers] = useState<string[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);

  const signalingRef = useRef<SignalingClient | null>(null);
  const managerRef = useRef<WebRTCManager | null>(null);

  function appendLog(text: string) {
    setLog((prev) => [...prev, { id: nextLogId++, text }]);
  }

  function handleConnect() {
    const signaling = new SignalingClient(SIGNALING_URL, roomId);
    const manager = new WebRTCManager(signaling);
    signalingRef.current = signaling;
    managerRef.current = manager;

    signaling.on('open', () => appendLog('signaling: connected'));
    signaling.on('close', () => appendLog('signaling: disconnected'));
    signaling.on('message', (message) => {
      if (message.type === 'joined') {
        setMyPeerId(message.peerId);
        appendLog(`joined room as ${message.peerId} (existing peers: ${message.peers?.join(', ') || 'none'})`);
      } else if (message.type === 'error') {
        appendLog(`signaling error: ${message.message}`);
      }
    });

    manager.on('peer-connected', ({ peerId }) => {
      setPeers((prev) => (prev.includes(peerId) ? prev : [...prev, peerId]));
      appendLog(`data channel open with ${peerId}`);
    });
    manager.on('peer-disconnected', ({ peerId }) => {
      setPeers((prev) => prev.filter((id) => id !== peerId));
      appendLog(`disconnected from ${peerId}`);
    });
    manager.on('message', ({ peerId, data }) => {
      appendLog(`${peerId}: ${data}`);
    });

    signaling.connect();
    setConnected(true);
  }

  function handleDisconnect() {
    managerRef.current?.close();
    signalingRef.current?.close();
    managerRef.current = null;
    signalingRef.current = null;
    setConnected(false);
    setMyPeerId(null);
    setPeers([]);
  }

  function handleSend() {
    if (!messageInput) return;
    managerRef.current?.broadcast(messageInput);
    appendLog(`me: ${messageInput}`);
    setMessageInput('');
  }

  useEffect(() => {
    return () => {
      managerRef.current?.close();
      signalingRef.current?.close();
    };
  }, []);

  return (
    <div style={{ textAlign: 'left', fontFamily: 'monospace' }}>
      <div style={{ marginBottom: '1rem' }}>
        <input
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          disabled={connected}
          placeholder="room id"
        />
        {connected ? (
          <button onClick={handleDisconnect}>Disconnect</button>
        ) : (
          <button onClick={handleConnect}>Connect</button>
        )}
      </div>

      {connected && (
        <div style={{ marginBottom: '1rem' }}>
          <div>My peer id: {myPeerId ?? '(connecting...)'}</div>
          <div>Connected data channels: {peers.length ? peers.join(', ') : '(none yet)'}</div>
        </div>
      )}

      {connected && (
        <div style={{ marginBottom: '1rem' }}>
          <input
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="message to broadcast"
          />
          <button onClick={handleSend}>Send</button>
        </div>
      )}

      <div
        style={{
          textAlign: 'left',
          maxHeight: '300px',
          overflowY: 'auto',
          border: '1px solid #444',
          padding: '0.5rem',
        }}
      >
        {log.map((entry) => (
          <div key={entry.id}>{entry.text}</div>
        ))}
      </div>
    </div>
  );
}
