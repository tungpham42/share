export type Peer = "host" | "viewer";

export interface SdpPayload {
  sdp: RTCSessionDescriptionInit;
  viewerId: string; // Added to route signaling to the correct peer
}

export interface IceCandidatePayload {
  from: Peer;
  candidate: RTCIceCandidateInit;
  viewerId: string; // Added to route candidates to the correct peer
}

export interface JoinPayload {
  viewerId: string; // Identifies the connecting viewer
}
