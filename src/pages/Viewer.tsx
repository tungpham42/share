import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "../lib/supabaseClient";
import { fetchIceServers } from "../lib/iceServers";
import type { SdpPayload, IceCandidatePayload } from "../lib/signaling";
import {
  bindConnectionState,
  relayLocalIceCandidates,
  bindRemoteCameraStream, // NEW Import
} from "../lib/webrtcSignaling";

import { Card, Button, Typography, Alert } from "antd";
import { EyeOutlined, SoundOutlined, LoadingOutlined } from "@ant-design/icons";

const { Title, Text } = Typography;

type Status = "waiting" | "connecting" | "connected" | "ended" | "error";

const STATUS_TEXT: Record<Status, string | null> = {
  waiting: "Grabbing a seat... Waiting for the host to start sharing.",
  connecting: "Connecting you to the stream…",
  connected: null,
  ended: "The session has ended. Thanks for watching!",
  error: "Oops! Something went wrong.",
};

export default function Viewer() {
  const { roomId } = useParams<{ roomId: string }>();
  const [status, setStatus] = useState<Status>("waiting");
  const [error, setError] = useState<string | null>(null);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setError("Missing Supabase configuration. Please check your .env file.");
      setStatus("error");
      return;
    }

    let cancelled = false;
    let joinInterval: ReturnType<typeof setInterval> | undefined;
    let pc: RTCPeerConnection | undefined;
    let channel: RealtimeChannel | undefined;

    // Generate a unique ID for this specific viewer session
    const viewerId = Math.random().toString(36).substring(2, 15);

    async function setup() {
      try {
        const iceServers = await fetchIceServers();
        if (cancelled) return;

        pc = new RTCPeerConnection({ iceServers });

        // --- NEW: Use the safe binder that guarantees event.streams[0] ---
        bindRemoteCameraStream(pc, (stream) => {
          const video = videoRef.current;
          if (!video) return;

          // Only assign and play if the stream is new (prevents multiple play calls on multi-track streams)
          if (video.srcObject !== stream) {
            video.srcObject = stream;
            video.play().catch(() => {
              video.muted = true;
              setNeedsUnmute(true);
              video
                .play()
                .catch((err) => console.error("Video playback failed:", err));
            });
          }
        });

        bindConnectionState(pc, {
          onConnected: () => {
            if (!cancelled) setStatus("connected");
          },
          onTerminal: () => {
            if (!cancelled) setStatus("ended");
          },
        });

        channel = supabase!.channel(`room-${roomId}`, {
          config: { broadcast: { self: false } },
        });

        // Forward local ICE candidates with our unique ID
        relayLocalIceCandidates(pc, channel, "viewer", viewerId);

        // Listen for remote ICE candidates directed ONLY at this viewerId
        channel.on(
          "broadcast",
          { event: "ice-candidate" },
          async ({ payload }: { payload: IceCandidatePayload }) => {
            if (payload.from !== "host" || payload.viewerId !== viewerId)
              return;
            try {
              await pc!.addIceCandidate(payload.candidate);
            } catch (err) {
              console.error("Error adding ICE candidate", err);
            }
          },
        );

        // Listen for an offer directed ONLY at this viewerId
        channel.on(
          "broadcast",
          { event: "offer" },
          async ({ payload }: { payload: SdpPayload }) => {
            if (payload.viewerId !== viewerId) return;

            clearInterval(joinInterval); // Stop pinging the host once we're acknowledged
            setStatus("connecting");

            await pc!.setRemoteDescription(payload.sdp);
            const answer = await pc!.createAnswer();
            await pc!.setLocalDescription(answer);

            const answerPayload: SdpPayload = { sdp: answer, viewerId };
            channel!.send({
              type: "broadcast",
              event: "answer",
              payload: answerPayload,
            });
          },
        );

        channel.subscribe((subStatus) => {
          if (subStatus === "SUBSCRIBED" && !cancelled && channel) {
            // Keep knocking until the host creates an offer for us
            channel.send({
              type: "broadcast",
              event: "join",
              payload: { viewerId },
            });
            joinInterval = setInterval(() => {
              channel!.send({
                type: "broadcast",
                event: "join",
                payload: { viewerId },
              });
            }, 3000);
          }
        });
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setStatus("error");
        }
      }
    }

    setup();

    return () => {
      cancelled = true;
      clearInterval(joinInterval);
      pc?.close();
      if (channel) supabase!.removeChannel(channel);
    };
  }, [roomId]);

  const unmute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.play();
    setNeedsUnmute(false);
  };

  return (
    <div className="page-container">
      <Card
        bordered={false}
        style={{
          boxShadow: "0 20px 40px rgba(0,0,0,0.08)",
          textAlign: "center",
          padding: "1rem",
        }}
      >
        <Title level={2} style={{ marginTop: 0, color: "#ff7a45" }}>
          Viewing Screen Share <EyeOutlined />
        </Title>

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            style={{ marginBottom: "1rem" }}
          />
        )}

        {!error && STATUS_TEXT[status] && (
          <Text
            type="secondary"
            style={{
              fontSize: "1.1rem",
              display: "block",
              marginBottom: "1.5rem",
            }}
          >
            {status === "waiting" || status === "connecting" ? (
              <LoadingOutlined style={{ marginRight: 8 }} />
            ) : null}
            {STATUS_TEXT[status]}
          </Text>
        )}

        <div
          className="video-wrapper"
          style={{
            display:
              status === "waiting" || status === "error" ? "none" : "block",
          }}
        >
          <video ref={videoRef} className="viewer-video" autoPlay playsInline />
        </div>

        {needsUnmute && (
          <Button
            type="primary"
            size="large"
            icon={<SoundOutlined />}
            onClick={unmute}
            style={{ marginTop: "1rem" }}
          >
            Click to Unmute Audio
          </Button>
        )}
      </Card>
    </div>
  );
}
