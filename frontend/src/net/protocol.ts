// Mirrors signaling-server/internal/ws/protocol.go by hand. There's no
// shared schema/codegen between the Go server and this client — the
// protocol is small and fixed enough that keeping both sides typed
// independently is worth more (you can read either side on its own and
// see the whole contract) than the payoff of generating one from the
// other.
//
// Unlike the Go Envelope (one struct with every field optional), this is
// split into what we *send* vs. what we *receive*. The server always
// stamps a relayed offer/answer/ice-candidate with `from` before it
// reaches us, so on the receiving side `from` is required — no need for
// `!` non-null assertions when handling incoming messages.

export interface OutgoingOffer {
  type: 'offer';
  to: string;
  sdp: RTCSessionDescriptionInit;
}

export interface OutgoingAnswer {
  type: 'answer';
  to: string;
  sdp: RTCSessionDescriptionInit;
}

export interface OutgoingIceCandidate {
  type: 'ice-candidate';
  to: string;
  candidate: RTCIceCandidateInit;
}

export type OutgoingMessage = OutgoingOffer | OutgoingAnswer | OutgoingIceCandidate;

export interface JoinedMessage {
  type: 'joined';
  peerId: string;
  peers?: string[];
}

export interface PeerJoinedMessage {
  type: 'peer-joined';
  peerId: string;
}

export interface PeerLeftMessage {
  type: 'peer-left';
  peerId: string;
}

export interface IncomingOffer {
  type: 'offer';
  from: string;
  sdp: RTCSessionDescriptionInit;
}

export interface IncomingAnswer {
  type: 'answer';
  from: string;
  sdp: RTCSessionDescriptionInit;
}

export interface IncomingIceCandidate {
  type: 'ice-candidate';
  from: string;
  candidate: RTCIceCandidateInit;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type IncomingMessage =
  | JoinedMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | IncomingOffer
  | IncomingAnswer
  | IncomingIceCandidate
  | ErrorMessage;
