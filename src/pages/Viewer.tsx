// Viewer.tsx
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "../lib/supabaseClient";
import { fetchIceServers } from "../lib/iceServers";
import type { SdpPayload, IceCandidatePayload } from "../lib/signaling";
import {
  bindConnectionState,
  relayLocalIceCandidates,
  bindRemoteCameraStream,
  getLocalCameraStream,
  addCameraStreamToConnection,
} from "../lib/webrtcSignaling";

import { Card, Button, Typography, Alert, Input, Space, List } from "antd";
import {
  SoundOutlined,
  LoadingOutlined,
  DesktopOutlined,
  VideoCameraOutlined,
  TeamOutlined,
  SendOutlined,
  AudioOutlined,
  AudioMutedOutlined,
} from "@ant-design/icons";

const { Title, Text } = Typography;

type Status = "waiting" | "connecting" | "connected" | "ended" | "error";

interface ChatMessage {
  id: string;
  senderId: string;
  senderType: "host" | "viewer";
  text: string;
  timestamp: number;
}

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

  // Local Microphone State
  const [isMuted, setIsMuted] = useState(false);

  const [shareMode, setShareMode] = useState<"screen" | "camera" | "call">(
    "screen",
  );

  // Group Chat State Elements
  const [myViewerId] = useState(() =>
    Math.random().toString(36).substring(2, 15),
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [textInput, setTextInput] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null); // Remote Host Stream
  const localVideoRef = useRef<HTMLVideoElement>(null); // Viewer's Local Stream Element
  const localStreamRef = useRef<MediaStream | null>(null); // Viewer's Local Stream Object

  const channelRef = useRef<RealtimeChannel | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Smooth scroll helper for incoming chat activity
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setError("Missing Supabase configuration. Please check your .env file.");
      setStatus("error");
      return;
    }

    let cancelled = false;
    let joinInterval: ReturnType<typeof setInterval> | undefined;
    let pc: RTCPeerConnection | undefined;

    async function setup() {
      try {
        const iceServers = await fetchIceServers();
        if (cancelled) return;

        pc = new RTCPeerConnection({ iceServers });

        bindRemoteCameraStream(pc, (stream) => {
          const video = videoRef.current;
          if (!video) return;

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

        const channel = supabase!.channel(`room-${roomId}`, {
          config: { broadcast: { self: false } },
        });
        channelRef.current = channel;

        relayLocalIceCandidates(pc, channel, "viewer", myViewerId);

        // Listen for standard text messages sent by anyone else in the room
        channel.on(
          "broadcast",
          { event: "chat-message" },
          ({ payload }: { payload: ChatMessage }) => {
            setMessages((prev) => [...prev, payload]);
          },
        );

        channel.on(
          "broadcast",
          { event: "ice-candidate" },
          async ({ payload }: { payload: IceCandidatePayload }) => {
            if (payload.from !== "host" || payload.viewerId !== myViewerId)
              return;
            try {
              await pc!.addIceCandidate(payload.candidate);
            } catch (err) {
              console.error("Error adding ICE candidate", err);
            }
          },
        );

        channel.on(
          "broadcast",
          { event: "offer" },
          async ({ payload }: { payload: SdpPayload }) => {
            if (payload.viewerId !== myViewerId) return;

            if (payload.mode) {
              setShareMode(payload.mode);
            }

            clearInterval(joinInterval);
            setStatus("connecting");

            await pc!.setRemoteDescription(payload.sdp);

            // Handle 2-way call mode by acquiring local viewer media
            if (payload.mode === "call") {
              try {
                const stream = await getLocalCameraStream();
                localStreamRef.current = stream; // Store in ref for muting

                if (localVideoRef.current) {
                  localVideoRef.current.srcObject = stream;
                }
                addCameraStreamToConnection(pc!, stream);
              } catch (err) {
                console.warn("Could not access camera/mic for the call", err);
              }
            }

            const answer = await pc!.createAnswer();
            await pc!.setLocalDescription(answer);

            const answerPayload: SdpPayload = {
              sdp: answer,
              viewerId: myViewerId,
            };
            channel!.send({
              type: "broadcast",
              event: "answer",
              payload: answerPayload,
            });
          },
        );

        channel.subscribe((subStatus) => {
          if (subStatus === "SUBSCRIBED" && !cancelled && channel) {
            channel.send({
              type: "broadcast",
              event: "join",
              payload: { viewerId: myViewerId },
            });
            joinInterval = setInterval(() => {
              channel!.send({
                type: "broadcast",
                event: "join",
                payload: { viewerId: myViewerId },
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
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (channelRef.current) supabase!.removeChannel(channelRef.current);
    };
  }, [roomId, myViewerId]);

  // Toggles the enabled state of the local microphone tracks
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      const nextMuteState = !isMuted;
      audioTracks.forEach((track) => {
        track.enabled = !nextMuteState;
      });
      setIsMuted(nextMuteState);
    }
  };

  // Sends the local text payload to everyone connected to the room channel
  const handleSendMessage = () => {
    if (!textInput.trim() || !channelRef.current) return;

    const messagePayload: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      senderId: myViewerId,
      senderType: "viewer",
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

  const unmutePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.play();
    setNeedsUnmute(false);
  };

  return (
    <div
      className="page-container"
      style={{ maxWidth: "1200px", margin: "0 auto", padding: "1rem" }}
    >
      <Card
        bordered={false}
        style={{
          boxShadow: "0 20px 40px rgba(0,0,0,0.08)",
          padding: "1rem",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "1rem" }}>
          <Title level={2} style={{ marginTop: 0, color: "#ff7a45" }}>
            {shareMode === "call"
              ? "Video Call Room"
              : `Viewing ${shareMode === "camera" ? "Camera" : "Screen"} Share`}{" "}
            {shareMode === "call" ? (
              <TeamOutlined />
            ) : shareMode === "camera" ? (
              <VideoCameraOutlined />
            ) : (
              <DesktopOutlined />
            )}
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
              style={{ fontSize: "1.1rem", display: "block" }}
            >
              {status === "waiting" || status === "connecting" ? (
                <LoadingOutlined style={{ marginRight: 8 }} />
              ) : null}
              {STATUS_TEXT[status]}
            </Text>
          )}
        </div>

        {/* Dynamic Horizontal Grid Layout splitting Stream Frame and Group Text Feed */}
        <div
          style={{
            display:
              status === "waiting" || status === "error" ? "none" : "grid",
            gridTemplateColumns: "1fr minmax(300px, 350px)",
            gap: "20px",
            alignItems: "start",
          }}
        >
          {/* Main Content Area: Feeds */}
          <div className="video-wrapper" style={{ position: "relative" }}>
            {/* Host Stream */}
            <video
              ref={videoRef}
              className="viewer-video"
              autoPlay
              playsInline
              style={{
                width: "100%",
                borderRadius: 8,
                backgroundColor: "#000",
              }}
            />

            {/* Picture-in-Picture for Viewer's Local Camera during a Call */}
            {shareMode === "call" && (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                style={{
                  position: "absolute",
                  bottom: 20,
                  right: 20,
                  width: 130,
                  border: "2px solid #fff",
                  borderRadius: 8,
                  backgroundColor: "#333",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                }}
              />
            )}

            <div style={{ textAlign: "center", marginTop: "1rem" }}>
              {needsUnmute && (
                <Button
                  type="primary"
                  size="large"
                  icon={<SoundOutlined />}
                  onClick={unmutePlayback}
                  style={{ marginRight: "1rem" }}
                >
                  Click to Unmute Audio
                </Button>
              )}

              {shareMode === "call" && (
                <Button
                  size="large"
                  icon={isMuted ? <AudioMutedOutlined /> : <AudioOutlined />}
                  onClick={toggleMute}
                  danger={isMuted}
                >
                  {isMuted ? "Unmute Mic" : "Mute Mic"}
                </Button>
              )}
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

            {/* Thread Area */}
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
                  const isMe = msg.senderId === myViewerId;
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
                        {msg.senderType === "host"
                          ? "Host"
                          : isMe
                            ? "You"
                            : `User (${msg.senderId.slice(0, 4)})`}
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

            {/* Input Form Box */}
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
      </Card>
    </div>
  );
}
