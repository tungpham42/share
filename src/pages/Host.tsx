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
  getLocalScreenStream,
  addCameraStreamToConnection,
  bindRemoteCameraStream,
} from "../lib/webrtcSignaling";

import { Card, Button, Typography, Space, Input, Alert, List } from "antd";
import {
  DesktopOutlined,
  CopyOutlined,
  CheckOutlined,
  StopOutlined,
  ApiOutlined,
  SmileOutlined,
  VideoCameraOutlined,
  TeamOutlined,
  SendOutlined,
  AudioOutlined,
  AudioMutedOutlined,
} from "@ant-design/icons";

const { Title, Text } = Typography;

type Status =
  | "idle"
  | "sharing"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

interface ChatMessage {
  id: string;
  senderId: string;
  senderType: "host" | "viewer";
  text: string;
  timestamp: number;
}

const getStatusText = (status: Status, count: number): React.ReactNode => {
  if (status === "idle") return "Ready to start sharing or chatting.";
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

// Sub-component to dynamically render multiple remote viewer streams
const RemoteVideoPlayer = ({ stream }: { stream: MediaStream }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      style={{
        width: "100%",
        maxWidth: "300px",
        borderRadius: 8,
        backgroundColor: "#000",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
      }}
    />
  );
};

export default function Host() {
  const [status, setStatus] = useState<Status>("idle");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [currentMode, setCurrentMode] = useState<"screen" | "camera" | "call">(
    "screen",
  );

  // Local Microphone State
  const [isMuted, setIsMuted] = useState(false);

  // State to hold multiple remote streams for a 1-to-many call
  const [viewerStreams, setViewerStreams] = useState<
    Record<string, MediaStream>
  >({});

  // Chat States
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [textInput, setTextInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const videoRef = useRef<HTMLVideoElement>(null); // Local preview

  const peersRef = useRef<Record<string, RTCPeerConnection>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Smooth scroll chat to bottom when a new message arrives
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const cleanup = useCallback(() => {
    Object.values(peersRef.current).forEach((pc) => pc.close());
    peersRef.current = {};
    setViewerCount(0);
    setViewerStreams({}); // Clear remote streams
    setMessages([]); // Clear chat
    setIsMuted(false); // Reset mute state

    if (channelRef.current) {
      supabase?.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [status]);

  const startShare = useCallback(
    async (mode: "screen" | "camera" | "call" = "screen") => {
      setError(null);
      setCurrentMode(mode);
      setViewerStreams({});

      if (!supabaseConfigured || !supabase) {
        setError(
          "Missing Supabase configuration. Please check your .env file.",
        );
        setStatus("error");
        return;
      }

      try {
        const stream =
          mode === "camera" || mode === "call"
            ? await getLocalCameraStream()
            : await getLocalScreenStream();

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

        // Listen for incoming chat messages
        channel.on(
          "broadcast",
          { event: "chat-message" },
          ({ payload }: { payload: ChatMessage }) => {
            setMessages((prev) => [...prev, payload]);
          },
        );

        channel.on(
          "broadcast",
          { event: "join" },
          async ({ payload }: { payload: JoinPayload }) => {
            const { viewerId } = payload;
            if (!viewerId || peersRef.current[viewerId]) return;

            if (viewerCount === 0) setStatus("connecting");

            const pc = new RTCPeerConnection({ iceServers });
            peersRef.current[viewerId] = pc;

            // Dynamically store incoming viewer streams by ID
            if (mode === "call") {
              bindRemoteCameraStream(pc, (remoteStream) => {
                setViewerStreams((prev) => ({
                  ...prev,
                  [viewerId]: remoteStream,
                }));
              });
            }

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

                // Remove the disconnected viewer's stream from state
                setViewerStreams((prev) => {
                  const updatedStreams = { ...prev };
                  delete updatedStreams[viewerId];
                  return updatedStreams;
                });

                const activeCount = Object.keys(peersRef.current).length;
                setViewerCount(activeCount);
                if (activeCount === 0 && streamRef.current)
                  setStatus("sharing");
              },
            });

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            const sdpPayload: SdpPayload = { sdp: offer, viewerId, mode };
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

  // Toggles the enabled state of the local microphone tracks
  const toggleMute = () => {
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      const nextMuteState = !isMuted;
      audioTracks.forEach((track) => {
        track.enabled = !nextMuteState;
      });
      setIsMuted(nextMuteState);
    }
  };

  const handleSendMessage = () => {
    if (!textInput.trim() || !channelRef.current) return;

    const messagePayload: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      senderId: "host",
      senderType: "host",
      text: textInput.trim(),
      timestamp: Date.now(),
    };

    channelRef.current.send({
      type: "broadcast",
      event: "chat-message",
      payload: messagePayload,
    });

    // Manually push your message to state since Supabase filters self-broadcasts
    setMessages((prev) => [...prev, messagePayload]);
    setTextInput("");
  };

  const stopShare = useCallback(() => {
    cleanup();
    setStatus("idle");
    setRoomId(null);
    setCopied(false);
  }, [cleanup]);

  const shareUrl = roomId ? `${window.location.origin}/room/${roomId}` : null;

  return (
    <div
      className="page-container"
      style={{ maxWidth: "1200px", margin: "0 auto", padding: "1rem" }}
    >
      <Card
        bordered={false}
        style={{
          boxShadow: "0 20px 40px rgba(0,0,0,0.08)",
          textAlign: "center",
          padding: "1rem",
        }}
      >
        <Title level={2} style={{ marginTop: 0, color: "#ff7a45" }}>
          SOFTY Share <DesktopOutlined />
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
          <Space
            wrap
            align="center"
            style={{ width: "100%", justifyContent: "center" }}
          >
            <Button
              type="primary"
              size="large"
              icon={<DesktopOutlined />}
              onClick={() => startShare("screen")}
            >
              Share Screen
            </Button>
            <Button
              type="default"
              size="large"
              icon={<VideoCameraOutlined />}
              onClick={() => startShare("camera")}
            >
              Share Camera
            </Button>
            <Button
              type="default"
              size="large"
              icon={<TeamOutlined />}
              onClick={() => startShare("call")}
            >
              Start Video Call
            </Button>
          </Space>
        ) : (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            {shareUrl && (
              <Space.Compact
                style={{
                  width: "100%",
                  maxWidth: 500,
                  margin: "0 auto",
                  display: "flex",
                }}
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

            {/* Split Grid for Stream & Chat */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr minmax(300px, 350px)",
                gap: "20px",
                alignItems: "start",
                textAlign: "left",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                }}
              >
                <div className="video-wrapper">
                  {currentMode === "call" ? (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "10px",
                        justifyContent: "center",
                      }}
                    >
                      {/* Local Host Camera */}
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        style={{
                          width: "100%",
                          maxWidth: "300px",
                          border: "2px solid #ff7a45",
                          borderRadius: 8,
                          backgroundColor: "#333",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                        }}
                      />
                      {/* Remote Viewers Grid */}
                      {Object.entries(viewerStreams).map(([vid, stream]) => (
                        <RemoteVideoPlayer key={vid} stream={stream} />
                      ))}
                    </div>
                  ) : (
                    <video
                      ref={videoRef}
                      className="preview"
                      autoPlay
                      playsInline
                      muted
                    />
                  )}
                </div>

                <div style={{ textAlign: "center" }}>
                  <Space>
                    <Button
                      size="large"
                      icon={
                        isMuted ? <AudioMutedOutlined /> : <AudioOutlined />
                      }
                      onClick={toggleMute}
                      danger={isMuted}
                      style={{
                        padding: "0 2rem",
                        height: "3rem",
                        fontSize: "1.1rem",
                      }}
                    >
                      {isMuted ? "Unmute" : "Mute"}
                    </Button>
                    <Button
                      danger
                      size="large"
                      icon={<StopOutlined />}
                      onClick={stopShare}
                      style={{
                        padding: "0 2rem",
                        height: "3rem",
                        fontSize: "1.1rem",
                      }}
                    >
                      Stop Sharing
                    </Button>
                  </Space>
                </div>
              </div>

              {/* Group Chat Section */}
              <div
                style={{
                  border: "1px solid #f0f0f0",
                  borderRadius: 12,
                  padding: "1rem",
                  backgroundColor: "#fafafa",
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  minHeight: "400px",
                }}
              >
                <Title
                  level={4}
                  style={{
                    marginTop: 0,
                    marginBottom: "0.5rem",
                    borderBottom: "1px solid #e8e8e8",
                    paddingBottom: "0.5rem",
                  }}
                >
                  Room Chat
                </Title>

                <div
                  style={{
                    flexGrow: 1,
                    overflowY: "auto",
                    maxHeight: "320px",
                    marginBottom: "1rem",
                    paddingRight: "4px",
                  }}
                >
                  <List
                    dataSource={messages}
                    locale={{ emptyText: "No messages yet. Say hi!" }}
                    renderItem={(msg) => {
                      const isMe = msg.senderType === "host";
                      return (
                        <div
                          style={{
                            textAlign: isMe ? "right" : "left",
                            marginBottom: "0.8rem",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.75rem",
                              color: "#8c8c8c",
                              marginBottom: "2px",
                            }}
                          >
                            {isMe
                              ? "You (Host)"
                              : `Viewer (${msg.senderId.slice(0, 4)})`}
                          </div>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "6px 12px",
                              borderRadius: "12px",
                              backgroundColor: isMe ? "#ff7a45" : "#e8e8e8",
                              color: isMe ? "#fff" : "#000",
                              maxWidth: "85%",
                              textAlign: "left",
                              wordBreak: "break-word",
                            }}
                          >
                            {msg.text}
                          </span>
                        </div>
                      );
                    }}
                  />
                  <div ref={chatEndRef} />
                </div>

                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    placeholder="Type a message..."
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onPressEnter={handleSendMessage}
                  />
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    onClick={handleSendMessage}
                    disabled={!textInput.trim()}
                  />
                </Space.Compact>
              </div>
            </div>
          </Space>
        )}
      </Card>
    </div>
  );
}
