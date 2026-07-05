import { Emitter } from './emitter';
import type { IncomingMessage, OutgoingMessage } from './protocol';

type SignalingEvents = {
  open: undefined;
  close: undefined;
  message: IncomingMessage;
};

// Thin wrapper around a single WebSocket connection to the signaling
// server. It knows the wire format (JSON envelopes) but nothing about
// WebRTC — that's WebRTCManager's job, kept separate so each half can be
// reasoned about (and eventually tested) independently.
export class SignalingClient {
  private readonly url: string;
  private readonly roomId: string;
  private ws: WebSocket | null = null;
  private readonly emitter = new Emitter<SignalingEvents>();

  constructor(url: string, roomId: string) {
    this.url = url;
    this.roomId = roomId;
  }

  connect(): void {
    const ws = new WebSocket(`${this.url}?room=${encodeURIComponent(this.roomId)}`);
    ws.addEventListener('open', () => this.emitter.emit('open', undefined));
    ws.addEventListener('close', () => this.emitter.emit('close', undefined));
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string) as IncomingMessage;
      this.emitter.emit('message', message);
    });
    this.ws = ws;
  }

  send(message: OutgoingMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('SignalingClient: cannot send, socket is not open');
    }
    this.ws.send(JSON.stringify(message));
  }

  on<K extends keyof SignalingEvents>(event: K, listener: (payload: SignalingEvents[K]) => void): () => void {
    return this.emitter.on(event, listener);
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
