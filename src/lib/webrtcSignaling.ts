import type { RealtimeChannel } from "@supabase/supabase-js"; //
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

// --- Camera & Screen Sharing Features ---

/**
 * Requests access to the user's camera and microphone.
 */
export async function getLocalCameraStream(): Promise<MediaStream> {
  return await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
}

/**
 * Requests screen sharing and microphone access, mixing both audio sources
 * together so viewers can hear both system audio and the host speaking.
 */
export async function getLocalScreenStream(): Promise<MediaStream> {
  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true, // Prompts user to share tab/system audio
  });

  try {
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    const displayAudioTracks = displayStream.getAudioTracks();

    // If user shared system audio, mix it with the microphone
    if (displayAudioTracks.length > 0) {
      const audioContext = new AudioContext();
      const dest = audioContext.createMediaStreamDestination();

      audioContext.createMediaStreamSource(displayStream).connect(dest);
      audioContext.createMediaStreamSource(micStream).connect(dest);

      const mixedAudioTrack = dest.stream.getAudioTracks()[0];

      return new MediaStream([
        ...displayStream.getVideoTracks(),
        mixedAudioTrack,
      ]);
    } else {
      // If no system audio was shared, just bundle the mic audio
      return new MediaStream([
        ...displayStream.getVideoTracks(),
        ...micStream.getAudioTracks(),
      ]);
    }
  } catch (err) {
    console.warn("Microphone access denied. Sharing screen audio only.", err);
    return displayStream;
  }
}

/**
 * Iterates through the local media stream and adds its tracks to the peer connection
 * so they can be negotiated and sent to the remote peer.
 */
export function addCameraStreamToConnection(
  pc: RTCPeerConnection,
  stream: MediaStream,
) {
  stream.getTracks().forEach((track) => {
    pc.addTrack(track, stream);
  });
}

/**
 * Listens for incoming remote media tracks (the other peer's camera/mic).
 */
export function bindRemoteCameraStream(
  pc: RTCPeerConnection,
  onTrackReceived: (stream: MediaStream) => void,
) {
  pc.ontrack = (event) => {
    if (event.streams && event.streams.length > 0) {
      onTrackReceived(event.streams[0]);
    }
  };
}
