import type { RealtimeChannel } from "@supabase/supabase-js";
import type { IceCandidatePayload, Peer } from "./signaling";

// Forwards locally-gathered ICE candidates to the other peer over the signaling channel.
export function relayLocalIceCandidates(
  pc: RTCPeerConnection,
  channel: RealtimeChannel,
  from: Peer,
  viewerId: string,
) {
  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    const payload: IceCandidatePayload = {
      from,
      candidate: event.candidate.toJSON(),
      viewerId,
    };
    channel.send({ type: "broadcast", event: "ice-candidate", payload });
  };
}

// 'disconnected' is often transient (brief network blip) and can self-recover, so only
// 'failed'/'closed' are treated as a terminal end of the connection.
export function bindConnectionState(
  pc: RTCPeerConnection,
  handlers: { onConnected: () => void; onTerminal: () => void },
) {
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") handlers.onConnected();
    if (pc.connectionState === "failed" || pc.connectionState === "closed")
      handlers.onTerminal();
  };
}
