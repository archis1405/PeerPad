import { ICE_SERVERS } from './config';
import { Emitter } from '../lib/emitter';
import type { SignalingClient } from './SignalingClient';
import type { IncomingMessage } from './protocol';

// One RTCPeerConnection (and its data channel) per remote peer. `pendingCandidates`
// exists because ICE candidates can arrive over the signaling channel before
// setRemoteDescription has completed for that peer — RTCPeerConnection.addIceCandidate
// rejects if called too early, so we queue and flush once the remote
// description is set.
interface PeerLink {
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  pendingCandidates: RTCIceCandidateInit[];
}

type WebRTCManagerEvents = {
  'peer-connected': { peerId: string };
  'peer-disconnected': { peerId: string };
  message: { peerId: string; data: string };
};

// Orchestrates a full mesh of RTCPeerConnections, one per other peer in
// the room, driven entirely by messages from a SignalingClient.
//
// Who initiates is decided by a simple, deterministic rule that avoids
// "glare" (both sides creating an offer at once): whoever was already in
// the room initiates the offer to whoever joins after them. Concretely:
//   - On "joined" (we are the newcomer): do nothing but get ready to
//     receive offers from each peer already in the room.
//   - On "peer-joined" (we were already here): we initiate — create the
//     data channel and send the offer.
// This generalizes past two peers for free: in an N-peer room, every
// existing peer independently initiates one connection to each newcomer.
export class WebRTCManager {
  private readonly signaling: SignalingClient;
  private readonly peers = new Map<string, PeerLink>();
  private readonly emitter = new Emitter<WebRTCManagerEvents>();
  private readonly unsubscribe: () => void;

  constructor(signaling: SignalingClient) {
    this.signaling = signaling;
    this.unsubscribe = signaling.on('message', (message) => this.handleSignalingMessage(message));
  }

  on<K extends keyof WebRTCManagerEvents>(
    event: K,
    listener: (payload: WebRTCManagerEvents[K]) => void,
  ): () => void {
    return this.emitter.on(event, listener);
  }

  send(peerId: string, data: string): void {
    const link = this.peers.get(peerId);
    if (!link?.dataChannel || link.dataChannel.readyState !== 'open') {
      throw new Error(`WebRTCManager: no open data channel to ${peerId}`);
    }
    link.dataChannel.send(data);
  }

  broadcast(data: string): void {
    for (const link of this.peers.values()) {
      if (link.dataChannel?.readyState === 'open') link.dataChannel.send(data);
    }
  }

  peerIds(): string[] {
    return [...this.peers.keys()];
  }

  close(): void {
    for (const peerId of [...this.peers.keys()]) this.teardown(peerId);
    this.unsubscribe();
  }

  private handleSignalingMessage(message: IncomingMessage): void {
    switch (message.type) {
      case 'joined':
        for (const peerId of message.peers ?? []) this.getOrCreateLink(peerId);
        break;
      case 'peer-joined':
        void this.initiateConnection(message.peerId);
        break;
      case 'peer-left':
        this.teardown(message.peerId);
        break;
      case 'offer':
        void this.handleOffer(message.from, message.sdp);
        break;
      case 'answer':
        void this.handleAnswer(message.from, message.sdp);
        break;
      case 'ice-candidate':
        void this.handleRemoteIceCandidate(message.from, message.candidate);
        break;
      case 'error':
        console.error('[signaling] error from server:', message.message);
        break;
    }
  }

  private getOrCreateLink(peerId: string): PeerLink {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const link: PeerLink = { connection, dataChannel: null, pendingCandidates: [] };
    this.peers.set(peerId, link);

    connection.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        this.signaling.send({ type: 'ice-candidate', to: peerId, candidate: event.candidate.toJSON() });
      }
    });

    connection.addEventListener('connectionstatechange', () => {
      const state = connection.connectionState;
      if (state === 'failed' || state === 'closed') this.teardown(peerId);
    });

    // The initiating side creates its data channel explicitly (see
    // initiateConnection); the answering side only ever learns about the
    // channel through this event.
    connection.addEventListener('datachannel', (event) => {
      this.wireDataChannel(peerId, event.channel);
    });

    return link;
  }

  private async initiateConnection(peerId: string): Promise<void> {
    const link = this.getOrCreateLink(peerId);
    this.wireDataChannel(peerId, link.connection.createDataChannel('peerpad'));

    const offer = await link.connection.createOffer();
    await link.connection.setLocalDescription(offer);
    this.signaling.send({ type: 'offer', to: peerId, sdp: offer });
  }

  private async handleOffer(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const link = this.getOrCreateLink(peerId);
    await link.connection.setRemoteDescription(sdp);
    await this.flushPendingCandidates(peerId);

    const answer = await link.connection.createAnswer();
    await link.connection.setLocalDescription(answer);
    this.signaling.send({ type: 'answer', to: peerId, sdp: answer });
  }

  private async handleAnswer(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const link = this.peers.get(peerId);
    if (!link) return; // answer for a connection we no longer track; ignore
    await link.connection.setRemoteDescription(sdp);
    await this.flushPendingCandidates(peerId);
  }

  private async handleRemoteIceCandidate(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const link = this.getOrCreateLink(peerId);
    if (!link.connection.remoteDescription) {
      link.pendingCandidates.push(candidate);
      return;
    }
    await link.connection.addIceCandidate(candidate);
  }

  private async flushPendingCandidates(peerId: string): Promise<void> {
    const link = this.peers.get(peerId);
    if (!link) return;
    const queued = link.pendingCandidates;
    link.pendingCandidates = [];
    for (const candidate of queued) {
      await link.connection.addIceCandidate(candidate);
    }
  }

  private wireDataChannel(peerId: string, channel: RTCDataChannel): void {
    const link = this.peers.get(peerId);
    if (!link) return;
    link.dataChannel = channel;

    channel.addEventListener('open', () => this.emitter.emit('peer-connected', { peerId }));
    channel.addEventListener('close', () => this.emitter.emit('peer-disconnected', { peerId }));
    channel.addEventListener('message', (event) => {
      this.emitter.emit('message', { peerId, data: event.data as string });
    });
  }

  private teardown(peerId: string): void {
    const link = this.peers.get(peerId);
    if (!link) return;
    link.dataChannel?.close();
    link.connection.close();
    this.peers.delete(peerId);
    this.emitter.emit('peer-disconnected', { peerId });
  }
}
