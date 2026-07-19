import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "../lib/supabaseClient";
import { fetchIceServers } from "../lib/iceServers";
import { generateRoomId } from "../lib/roomId";
import type {
  IceCandidatePayload,
  SdpPayload,
  JoinPayload,
} from "../lib/signaling";
import {
  bindConnectionState,
  relayLocalIceCandidates,
  getLocalCameraStream,
  getLocalScreenStream, // NEW Import
  addCameraStreamToConnection,
} from "../lib/webrtcSignaling";

import { Card, Button, Typography, Space, Input, Alert } from "antd";
import {
  DesktopOutlined,
  CopyOutlined,
  CheckOutlined,
  StopOutlined,
  ApiOutlined,
  SmileOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";

const { Title, Text } = Typography;

type Status =
  | "idle"
  | "sharing"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

const getStatusText = (status: Status, count: number): React.ReactNode => {
  if (status === "idle") return "Ready to share your screen or camera.";
  if (status === "sharing") return "Waiting for friendly faces to join…";
  if (status === "connecting") return "New viewer joining! Connecting…";
  if (status === "connected")
    return (
      <>
        Broadcasting to {count} viewer{count !== 1 ? "s" : ""}!{" "}
        <SmileOutlined />
      </>
    );
  if (status === "ended") return "Session ended securely.";
  if (status === "error") return "Oops! Something went wrong.";
  return null;
};

export default function Host() {
  const [status, setStatus] = useState<Status>("idle");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<Record<string, RTCPeerConnection>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    Object.values(peersRef.current).forEach((pc) => pc.close());
    peersRef.current = {};
    setViewerCount(0);

    if (channelRef.current) {
      supabase?.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // Securely attach the stream to the video element once it mounts
  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [status]);

  const startShare = useCallback(
    async (mode: "screen" | "camera" = "screen") => {
      setError(null);

      if (!supabaseConfigured || !supabase) {
        setError(
          "Missing Supabase configuration. Please check your .env file.",
        );
        setStatus("error");
        return;
      }

      try {
        // --- NEW: Use our custom screen stream function with audio mixing ---
        const stream =
          mode === "camera"
            ? await getLocalCameraStream()
            : await getLocalScreenStream(); // Updated

        streamRef.current = stream;

        stream.getVideoTracks()[0].addEventListener("ended", () => {
          setStatus("ended");
          cleanup();
        });

        const id = generateRoomId();
        setRoomId(id);
        setStatus("sharing");

        const iceServers = await fetchIceServers();
        const channel = supabase.channel(`room-${id}`, {
          config: { broadcast: { self: false } },
        });
        channelRef.current = channel;

        channel.on(
          "broadcast",
          { event: "join" },
          async ({ payload }: { payload: JoinPayload }) => {
            const { viewerId } = payload;
            if (!viewerId || peersRef.current[viewerId]) return;

            if (viewerCount === 0) setStatus("connecting");

            const pc = new RTCPeerConnection({ iceServers });
            peersRef.current[viewerId] = pc;

            addCameraStreamToConnection(pc, stream);

            relayLocalIceCandidates(pc, channel, "host", viewerId);

            bindConnectionState(pc, {
              onConnected: () => {
                const activeCount = Object.keys(peersRef.current).length;
                setViewerCount(activeCount);
                setStatus("connected");
              },
              onTerminal: () => {
                if (peersRef.current[viewerId]) {
                  peersRef.current[viewerId].close();
                  delete peersRef.current[viewerId];
                }
                const activeCount = Object.keys(peersRef.current).length;
                setViewerCount(activeCount);
                if (activeCount === 0 && streamRef.current)
                  setStatus("sharing");
              },
            });

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            const sdpPayload: SdpPayload = { sdp: offer, viewerId };
            channel.send({
              type: "broadcast",
              event: "offer",
              payload: sdpPayload,
            });
          },
        );

        channel.on(
          "broadcast",
          { event: "answer" },
          async ({ payload }: { payload: SdpPayload }) => {
            const pc = peersRef.current[payload.viewerId];
            if (pc && !pc.currentRemoteDescription) {
              await pc.setRemoteDescription(payload.sdp);
            }
          },
        );

        channel.on(
          "broadcast",
          { event: "ice-candidate" },
          async ({ payload }: { payload: IceCandidatePayload }) => {
            if (payload.from !== "viewer") return;
            const pc = peersRef.current[payload.viewerId];
            if (!pc) return;

            try {
              await pc.addIceCandidate(payload.candidate);
            } catch (err) {
              console.error("Error adding ICE candidate", err);
            }
          },
        );

        channel.subscribe();
      } catch (err) {
        setError((err as Error).message);
        setStatus("error");
        cleanup();
      }
    },
    [cleanup, viewerCount],
  );

  const stopShare = useCallback(() => {
    cleanup();
    setStatus("idle");
    setRoomId(null);
    setCopied(false);
  }, [cleanup]);

  const shareUrl = roomId ? `${window.location.origin}/room/${roomId}` : null;

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
          Share Your Stream <DesktopOutlined />
        </Title>

        {error ? (
          <Alert
            message={error}
            type="error"
            showIcon
            style={{ marginBottom: "1rem" }}
          />
        ) : (
          <Text
            type="secondary"
            style={{
              fontSize: "1.1rem",
              display: "block",
              marginBottom: "1.5rem",
            }}
          >
            {status === "connecting" || status === "sharing" ? (
              <ApiOutlined spin style={{ marginRight: 8 }} />
            ) : null}
            {getStatusText(status, viewerCount)}
          </Text>
        )}

        {status === "idle" || status === "ended" || status === "error" ? (
          <Space>
            <Button
              type="primary"
              size="large"
              icon={<DesktopOutlined />}
              onClick={() => startShare("screen")}
              style={{ padding: "0 2rem", height: "3rem", fontSize: "1.1rem" }}
            >
              Share Screen
            </Button>
            <Button
              type="default"
              size="large"
              icon={<VideoCameraOutlined />}
              onClick={() => startShare("camera")}
              style={{ padding: "0 2rem", height: "3rem", fontSize: "1.1rem" }}
            >
              Share Camera
            </Button>
          </Space>
        ) : (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            {shareUrl && (
              <Space.Compact
                style={{ width: "100%", maxWidth: 500, margin: "0 auto" }}
              >
                <Input
                  readOnly
                  size="large"
                  value={shareUrl}
                  onFocus={(e) => e.target.select()}
                />
                <Button
                  type={copied ? "default" : "primary"}
                  size="large"
                  icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                  onClick={async () => {
                    await navigator.clipboard.writeText(shareUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? "Copied!" : "Copy Link"}
                </Button>
              </Space.Compact>
            )}

            <div className="video-wrapper">
              <video
                ref={videoRef}
                className="preview"
                autoPlay
                playsInline
                muted
              />
            </div>

            <Button
              danger
              size="large"
              icon={<StopOutlined />}
              onClick={stopShare}
              style={{ padding: "0 2rem", height: "3rem", fontSize: "1.1rem" }}
            >
              Stop Sharing
            </Button>
          </Space>
        )}
      </Card>
    </div>
  );
}
