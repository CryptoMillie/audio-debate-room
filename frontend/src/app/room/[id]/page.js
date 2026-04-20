"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { getRoom, joinRoom } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import SimplePeer from "simple-peer";

/**
 * Room Page — handles:
 * 1. Joining the room via REST API
 * 2. Connecting to Socket.IO for signaling
 * 3. Creating WebRTC peer connections for audio
 * 4. Speaking indicator via AudioContext analyser
 */
export default function RoomPage() {
  const { id: roomId } = useParams();
  const router = useRouter();
  const { user, loading } = useAuth();

  const [room, setRoom] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [muted, setMuted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [speaking, setSpeaking] = useState(false); // Local user speaking

  // Refs to persist across renders without causing re-renders
  const peersRef = useRef({}); // { socketId: SimplePeer instance }
  const streamRef = useRef(null); // Local audio MediaStream
  const socketRef = useRef(null);
  const analyserRef = useRef(null); // AudioContext analyser for speaking detection
  const animFrameRef = useRef(null);

  // Clean up all peer connections
  const cleanupPeers = useCallback(() => {
    Object.values(peersRef.current).forEach((peer) => {
      if (peer && !peer.destroyed) peer.destroy();
    });
    peersRef.current = {};
  }, []);

  // Clean up everything on unmount or leave
  const cleanup = useCallback(() => {
    cleanupPeers();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    setConnected(false);
    setSpeaking(false);
  }, [cleanupPeers]);

  /**
   * Start monitoring local mic volume for speaking indicator.
   * Uses Web Audio API AnalyserNode to detect audio level.
   */
  const startSpeakingDetection = useCallback((stream) => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        // Average volume level
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        // Threshold: avg > 15 means someone is talking
        setSpeaking(avg > 15);
        animFrameRef.current = requestAnimationFrame(checkLevel);
      };
      checkLevel();
    } catch (e) {
      console.warn("Speaking detection not supported:", e);
    }
  }, []);

  /**
   * Create a new WebRTC peer connection to another user.
   */
  const createPeer = useCallback((targetSocketId, initiator, stream) => {
    // Prevent duplicate peers
    if (peersRef.current[targetSocketId]) return peersRef.current[targetSocketId];

    console.log(`Creating peer to ${targetSocketId}, initiator=${initiator}`);

    const peer = new SimplePeer({
      initiator,
      stream,
      trickle: true,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          // TURN server for users behind strict NATs
          ...(process.env.NEXT_PUBLIC_TURN_URL
            ? [{
                urls: process.env.NEXT_PUBLIC_TURN_URL,
                username: process.env.NEXT_PUBLIC_TURN_USERNAME,
                credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
              }]
            : []),
        ],
      },
    });

    peer.on("signal", (signal) => {
      console.log(`Sending signal to ${targetSocketId}:`, signal.type || "candidate");
      socketRef.current.emit("signal", { targetSocketId, signal });
    });

    peer.on("stream", (remoteStream) => {
      console.log(`Got remote stream from ${targetSocketId}`, remoteStream.getTracks());
      const existing = document.getElementById(`audio-${targetSocketId}`);
      if (existing) existing.remove();
      const audio = document.createElement("audio");
      audio.srcObject = remoteStream;
      audio.autoplay = true;
      audio.playsInline = true;
      audio.volume = 1.0;
      audio.id = `audio-${targetSocketId}`;
      document.body.appendChild(audio);
      audio.play().catch((e) => console.warn("Audio play blocked:", e));
    });

    peer.on("connect", () => {
      console.log(`Peer connected to ${targetSocketId}`);
    });

    peer.on("close", () => {
      const audioEl = document.getElementById(`audio-${targetSocketId}`);
      if (audioEl) audioEl.remove();
      delete peersRef.current[targetSocketId];
    });

    peer.on("error", (err) => {
      console.error(`Peer error with ${targetSocketId}:`, err.message);
      const audioEl = document.getElementById(`audio-${targetSocketId}`);
      if (audioEl) audioEl.remove();
      delete peersRef.current[targetSocketId];
    });

    peersRef.current[targetSocketId] = peer;
    return peer;
  }, []);

  // Fetch room info and join
  useEffect(() => {
    if (loading || !user) return;

    getRoom(roomId)
      .then((data) => {
        setRoom(data);
        return joinRoom(roomId, user.uid);
      })
      .catch((err) => setError(err.message));
  }, [roomId, user, loading]);

  // Connect to voice room
  const joinVoice = useCallback(async () => {
    if (!user) return;

    try {
      // Step 1: Get user's microphone audio
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;

      // Start speaking detection on local mic
      startSpeakingDetection(stream);

      // Step 2: Connect to Socket.IO signaling server
      const socket = getSocket();
      socketRef.current = socket;

      if (socket.connected) {
        socket.disconnect();
      }
      socket.connect();

      socket.on("connect", () => {
        console.log("Socket connected:", socket.id);

        // Step 3: Tell the server we're joining this room
        socket.emit("join-room", {
          roomId,
          userId: user.uid,
          displayName: user.displayName || user.email,
        });
      });

      socket.on("existing-users", (users) => {
        console.log("Existing users in room:", users.length);
        setParticipants(users);
        users.forEach((u) => {
          createPeer(u.socketId, true, stream);
        });
      });

      socket.on("user-connected", (newUser) => {
        console.log(`New user connected: ${newUser.displayName} (${newUser.socketId})`);
        setParticipants((prev) => [...prev, newUser]);
        createPeer(newUser.socketId, false, stream);
      });

      socket.on("signal", ({ fromSocketId, signal }) => {
        const peer = peersRef.current[fromSocketId];
        if (peer && !peer.destroyed) {
          peer.signal(signal);
        }
      });

      socket.on("user-disconnected", ({ socketId }) => {
        const peer = peersRef.current[socketId];
        if (peer && !peer.destroyed) peer.destroy();
        delete peersRef.current[socketId];
        const audioEl = document.getElementById(`audio-${socketId}`);
        if (audioEl) audioEl.remove();
        setParticipants((prev) => prev.filter((p) => p.socketId !== socketId));
      });

      setConnected(true);
    } catch (err) {
      console.error("Failed to join voice:", err);
      setError("Could not access microphone. Please allow mic access and try again.");
    }
  }, [user, roomId, createPeer, startSpeakingDetection]);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  // Toggle mute/unmute
  const toggleMute = () => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMuted(!audioTrack.enabled);
      }
    }
  };

  const leaveRoom = () => {
    cleanup();
    router.push("/");
  };

  if (loading) {
    return <div className="container" style={{ marginTop: 100, textAlign: "center" }}>Loading...</div>;
  }

  if (!user) {
    return (
      <div className="container" style={{ marginTop: 100, textAlign: "center" }}>
        <p>Please sign in to join a room.</p>
        <button className="btn-primary" onClick={() => router.push("/")} style={{ marginTop: 16 }}>
          Go to Sign In
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container" style={{ marginTop: 100, textAlign: "center" }}>
        <p style={{ color: "var(--danger)" }}>{error}</p>
        <button className="btn-outline" onClick={() => router.push("/")} style={{ marginTop: 16 }}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="container">
      {/* Header */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32, paddingTop: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4, letterSpacing: "0.05em" }}>BACKCHANNEL</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px" }}>{room?.title || "Loading..."}</h1>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            <code style={{ background: "rgba(22, 27, 36, 0.8)", padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>{roomId}</code>
          </p>
        </div>
        <button className="btn-danger" onClick={leaveRoom} style={{ padding: "8px 20px", fontSize: 13 }}>
          Leave
        </button>
      </header>

      {/* Join Voice / Controls */}
      {!connected ? (
        <div className="card" style={{ textAlign: "center", padding: "60px 40px" }}>
          <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.15 }}>
            <MicOnIcon size={48} />
          </div>
          <p style={{ marginBottom: 24, color: "var(--text-muted)", fontSize: 14 }}>
            Ready to join?
          </p>
          <button className="btn-primary" onClick={joinVoice} style={{ fontSize: 15, padding: "14px 40px", borderRadius: 8 }}>
            Join Voice
          </button>
        </div>
      ) : (
        <>
          {/* Audio Controls */}
          <div className="card" style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: 16, padding: "16px" }}>
            <button
              onClick={toggleMute}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "12px 28px",
                background: muted ? "transparent" : "var(--primary)",
                border: muted ? "1px solid rgba(224, 49, 49, 0.3)" : "none",
                color: muted ? "var(--danger)" : "#fff",
                borderRadius: 8,
              }}
            >
              {muted ? <><MicOffIcon /> Unmute</> : <><MicOnIcon /> Mute</>}
            </button>
          </div>

          {/* Participants */}
          <div className="card">
            <h2 style={{ fontSize: 12, marginBottom: 20, color: "var(--text-muted)", fontWeight: 500, letterSpacing: "0.05em" }}>
              IN ROOM ({participants.length + 1})
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
              <ParticipantCard name={user.displayName || "You"} isSelf muted={muted} speaking={speaking && !muted} />
              {participants.map((p) => (
                <ParticipantCard key={p.socketId} name={p.displayName} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ParticipantCard({ name, isSelf, muted, speaking }) {
  const isActive = speaking && !muted;
  return (
    <div
      style={{
        background: isActive ? "rgba(47, 158, 68, 0.06)" : "rgba(22, 27, 36, 0.5)",
        borderRadius: 12,
        padding: "20px 16px",
        textAlign: "center",
        border: isActive
          ? "1px solid rgba(47, 158, 68, 0.3)"
          : isSelf
          ? "1px solid rgba(59, 91, 219, 0.2)"
          : "1px solid transparent",
        transition: "all 0.2s",
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: isActive
            ? "linear-gradient(135deg, #2f9e44, #1a7a30)"
            : isSelf
            ? "linear-gradient(135deg, #3b5bdb, #2b4bc4)"
            : "var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 10px",
          fontSize: 20,
          fontWeight: 700,
          color: "#fff",
          animation: isActive ? "speakPulse 1.2s infinite" : "none",
          transition: "background 0.2s",
        }}
      >
        {(name || "?")[0].toUpperCase()}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
        {name}
      </div>
      {isSelf && (
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>You</div>
      )}
      {isSelf && muted && (
        <div style={{ fontSize: 10, color: "var(--danger)", marginTop: 4 }}>Muted</div>
      )}
      {isActive && (
        <div style={{ fontSize: 10, color: "var(--success)", marginTop: 4, animation: "glowPulse 1.5s infinite" }}>Speaking</div>
      )}
    </div>
  );
}

function MicOnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}
