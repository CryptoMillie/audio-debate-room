"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { getRoom, joinRoom, getTurnCredentials } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import SimplePeer from "simple-peer";

const VIBES = {
  chill: { color: "#6c5ce7", label: "CHILL" },
  debate: { color: "#e03131", label: "DEBATE" },
  truth: { color: "#f59f00", label: "TRUTH" },
  sport: { color: "#2f9e44", label: "SPORT" },
  music: { color: "#3b5bdb", label: "MUSIC" },
  breaking: { color: "#ff6b35", label: "BREAKING" },
};

export default function RoomPage() {
  const { id: roomId } = useParams();
  const router = useRouter();
  const { user, loading } = useAuth();

  const [room, setRoom] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [muted, setMuted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [speaking, setSpeaking] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [justJoined, setJustJoined] = useState(new Set());
  const [copied, setCopied] = useState(false);
  const [peerStatus, setPeerStatus] = useState({}); // { socketId: "connecting"|"connected"|"failed" }
  const [debugLog, setDebugLog] = useState([]);

  const addDebug = useCallback((msg) => {
    console.log(msg);
    setDebugLog((prev) => [...prev.slice(-15), `${new Date().toLocaleTimeString()} ${msg}`]);
  }, []);

  const peersRef = useRef({});
  const streamRef = useRef(null);
  const socketRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const chatEndRef = useRef(null);
  const iceServersRef = useRef(null);

  const cleanupPeers = useCallback(() => {
    Object.values(peersRef.current).forEach((peer) => {
      if (peer && !peer.destroyed) peer.destroy();
    });
    peersRef.current = {};
    setPeerStatus({});
  }, []);

  const cleanup = useCallback(() => {
    cleanupPeers();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (socketRef.current) {
      // Remove all listeners before disconnecting
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
    }
    setConnected(false);
    setSpeaking(false);
  }, [cleanupPeers]);

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
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        setSpeaking(avg > 15);
        animFrameRef.current = requestAnimationFrame(checkLevel);
      };
      checkLevel();
    } catch (e) {
      console.warn("Speaking detection not supported:", e);
    }
  }, []);

  const createPeer = useCallback((targetSocketId, initiator, stream) => {
    if (peersRef.current[targetSocketId]) return peersRef.current[targetSocketId];

    addDebug(`Creating peer to ${targetSocketId.slice(0,6)}… initiator=${initiator}`);
    setPeerStatus((prev) => ({ ...prev, [targetSocketId]: "connecting" }));

    const iceConfig = iceServersRef.current || [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ];
    addDebug(`ICE servers: ${iceConfig.length} (${iceConfig.some(s => s.urls?.toString().includes("turn")) ? "TURN+STUN" : "STUN only"})`);

    const peer = new SimplePeer({
      initiator,
      stream,
      trickle: true,
      config: { iceServers: iceConfig },
    });

    // Monitor ICE connection state
    peer._pc?.addEventListener?.("iceconnectionstatechange", () => {
      const state = peer._pc?.iceConnectionState;
      addDebug(`ICE state: ${state}`);
      if (state === "connected" || state === "completed") {
        setPeerStatus((prev) => ({ ...prev, [targetSocketId]: "connected" }));
      } else if (state === "failed" || state === "disconnected") {
        setPeerStatus((prev) => ({ ...prev, [targetSocketId]: "failed" }));
      }
    });

    peer.on("signal", (signal) => {
      addDebug(`Signal OUT: ${signal.type || "candidate"}`);
      socketRef.current?.emit("signal", { targetSocketId, signal });
    });

    peer.on("stream", (remoteStream) => {
      addDebug(`Got stream: ${remoteStream.getAudioTracks().length} audio tracks`);
      const existing = document.getElementById(`audio-${targetSocketId}`);
      if (existing) existing.remove();

      const audio = document.createElement("audio");
      audio.id = `audio-${targetSocketId}`;
      audio.setAttribute("playsinline", "");
      audio.volume = 1.0;
      document.body.appendChild(audio);
      audio.srcObject = remoteStream;

      let retries = 0;
      const tryPlay = () => {
        audio.play().then(() => {
          addDebug("Audio playing!");
        }).catch((e) => {
          addDebug(`Play failed (${retries + 1}): ${e.message}`);
          if (retries < 10) { retries++; setTimeout(tryPlay, 300); }
        });
      };
      tryPlay();
    });

    peer.on("connect", () => {
      addDebug("P2P CONNECTED");
      setPeerStatus((prev) => ({ ...prev, [targetSocketId]: "connected" }));
    });

    peer.on("close", () => {
      addDebug("Peer closed");
      const audioEl = document.getElementById(`audio-${targetSocketId}`);
      if (audioEl) audioEl.remove();
      delete peersRef.current[targetSocketId];
      setPeerStatus((prev) => { const n = { ...prev }; delete n[targetSocketId]; return n; });
    });

    peer.on("error", (err) => {
      addDebug(`Peer ERROR: ${err.message}`);
      setPeerStatus((prev) => ({ ...prev, [targetSocketId]: "failed" }));
      const audioEl = document.getElementById(`audio-${targetSocketId}`);
      if (audioEl) audioEl.remove();
      if (peersRef.current[targetSocketId] && !peersRef.current[targetSocketId].destroyed) {
        peersRef.current[targetSocketId].destroy();
      }
      delete peersRef.current[targetSocketId];
    });

    peersRef.current[targetSocketId] = peer;
    return peer;
  }, []);

  // Fetch room info
  useEffect(() => {
    if (loading || !user) return;
    getRoom(roomId)
      .then((data) => {
        setRoom(data);
        return joinRoom(roomId, user.uid);
      })
      .catch((err) => setError(err.message));
  }, [roomId, user, loading]);

  const joinVoice = useCallback(async () => {
    if (!user) return;

    try {
      // Resume AudioContext on user gesture (iOS)
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === "suspended") await ctx.resume();
        ctx.close();
      } catch (e) {}

      // Fetch TURN credentials from backend
      addDebug("Fetching ICE servers...");
      try {
        const { iceServers } = await getTurnCredentials();
        iceServersRef.current = iceServers;
        addDebug(`Got ${iceServers.length} ICE servers`);
      } catch (e) {
        addDebug("TURN fetch failed, STUN only");
        iceServersRef.current = [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ];
      }

      // Get mic
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      streamRef.current = stream;
      startSpeakingDetection(stream);

      // Socket setup — remove old listeners first
      const socket = getSocket();
      socketRef.current = socket;
      socket.removeAllListeners();

      if (socket.connected) socket.disconnect();
      socket.connect();

      socket.on("connect", () => {
        addDebug(`Socket connected: ${socket.id?.slice(0,6)}…`);
        socket.emit("join-room", {
          roomId,
          userId: user.uid,
          displayName: user.displayName || user.email,
          photoURL: user.photoURL || null,
        });
      });

      socket.on("existing-users", (users) => {
        addDebug(`Existing users: ${users.length}`);
        setParticipants(users);
        users.forEach((u) => createPeer(u.socketId, true, stream));
      });

      socket.on("user-connected", (newUser) => {
        addDebug(`User joined: ${newUser.displayName}`);
        setParticipants((prev) => [...prev, newUser]);
        createPeer(newUser.socketId, false, stream);
        setJustJoined((prev) => new Set([...prev, newUser.socketId]));
        setTimeout(() => {
          setJustJoined((prev) => { const next = new Set(prev); next.delete(newUser.socketId); return next; });
        }, 1500);
      });

      socket.on("signal", ({ fromSocketId, signal }) => {
        addDebug(`Signal IN: ${signal.type || "candidate"} from ${fromSocketId?.slice(0,6)}…`);
        let peer = peersRef.current[fromSocketId];
        if (!peer || peer.destroyed) {
          addDebug("Signal from unknown peer, creating responder");
          peer = createPeer(fromSocketId, false, stream);
        }
        peer.signal(signal);
      });

      socket.on("user-disconnected", ({ socketId }) => {
        const peer = peersRef.current[socketId];
        if (peer && !peer.destroyed) peer.destroy();
        delete peersRef.current[socketId];
        const audioEl = document.getElementById(`audio-${socketId}`);
        if (audioEl) audioEl.remove();
        setParticipants((prev) => prev.filter((p) => p.socketId !== socketId));
        setPeerStatus((prev) => { const n = { ...prev }; delete n[socketId]; return n; });
      });

      socket.on("chat-message", (msg) => {
        setMessages((prev) => [...prev, msg]);
      });

      socket.on("disconnect", (reason) => {
        addDebug(`Socket disconnected: ${reason}`);
      });

      setConnected(true);
    } catch (err) {
      console.error("Failed to join voice:", err);
      setError("Could not access microphone. Please allow mic access and try again.");
    }
  }, [user, roomId, createPeer, startSpeakingDetection]);

  useEffect(() => cleanup, [cleanup]);

  const toggleMute = () => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMuted(!audioTrack.enabled);
      }
    }
  };

  const leaveRoom = () => { cleanup(); router.push("/"); };

  const sendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !socketRef.current) return;
    const msg = { sender: user.displayName || user.email, photoURL: user.photoURL || null, text: chatInput.trim(), timestamp: Date.now() };
    socketRef.current.emit("chat-message", { roomId, text: chatInput.trim() });
    setMessages((prev) => [...prev, msg]);
    setChatInput("");
  };

  const shareRoom = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  if (loading) return <div className="container" style={{ marginTop: 100, textAlign: "center" }}>Loading...</div>;

  if (!user) {
    return (
      <div className="container" style={{ marginTop: 100, textAlign: "center" }}>
        <p>Please sign in to join a room.</p>
        <button className="btn-primary" onClick={() => router.push("/")} style={{ marginTop: 16 }}>Go to Sign In</button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container" style={{ marginTop: 100, textAlign: "center" }}>
        <p style={{ color: "var(--danger)" }}>{error}</p>
        <button className="btn-outline" onClick={() => router.push("/")} style={{ marginTop: 16 }}>Back to Dashboard</button>
      </div>
    );
  }

  // Connection status summary
  const connectedPeers = Object.values(peerStatus).filter((s) => s === "connected").length;
  const failedPeers = Object.values(peerStatus).filter((s) => s === "failed").length;

  return (
    <div className="container">
      {/* Header */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, paddingTop: 8, flexWrap: "wrap", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.05em" }}>BACKCHANNEL</span>
            {room?.vibe && VIBES[room.vibe] && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
                background: VIBES[room.vibe].color + "20", color: VIBES[room.vibe].color,
                letterSpacing: "0.05em",
                animation: room.vibe === "breaking" ? "breakingPulse 2s infinite" : "none",
              }}>{VIBES[room.vibe].label}</span>
            )}
          </div>
          <h1 style={{ fontSize: "clamp(18px, 5vw, 22px)", fontWeight: 700, color: "#fff", letterSpacing: "-0.5px", wordBreak: "break-word" }}>{room?.title || "Loading..."}</h1>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            <code style={{ background: "rgba(22, 27, 36, 0.8)", padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>{roomId}</code>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button className="btn-outline" onClick={shareRoom} style={{ padding: "8px 14px", fontSize: 12 }}>
            {copied ? "Copied" : "Share"}
          </button>
          <button className="btn-danger" onClick={leaveRoom} style={{ padding: "8px 14px", fontSize: 12 }}>Leave</button>
        </div>
      </header>

      {!connected ? (
        <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
          <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.15 }}><MicOnIcon size={48} /></div>
          <p style={{ marginBottom: 24, color: "var(--text-muted)", fontSize: 14 }}>Ready to join?</p>
          <button className="btn-primary" onClick={joinVoice} style={{ fontSize: 15, padding: "14px 40px", borderRadius: 8 }}>
            Join Voice
          </button>
        </div>
      ) : (
        <>
          {/* Audio Controls + Connection Status */}
          <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 16, padding: "16px" }}>
            <button
              onClick={toggleMute}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "12px 28px",
                background: muted ? "transparent" : "var(--primary)",
                border: muted ? "1px solid rgba(224, 49, 49, 0.3)" : "none",
                color: muted ? "var(--danger)" : "#fff", borderRadius: 8,
              }}
            >
              {muted ? <><MicOffIcon /> Unmute</> : <><MicOnIcon /> Mute</>}
            </button>
            {participants.length > 0 && (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {connectedPeers > 0 && (
                  <span style={{ color: "var(--success)" }}>{connectedPeers} connected</span>
                )}
                {failedPeers > 0 && (
                  <span style={{ color: "var(--danger)", marginLeft: connectedPeers > 0 ? 8 : 0 }}>{failedPeers} failed</span>
                )}
                {connectedPeers === 0 && failedPeers === 0 && (
                  <span>Connecting...</span>
                )}
              </div>
            )}
          </div>

          {/* Participants */}
          <div className="card">
            <h2 style={{ fontSize: 12, marginBottom: 20, color: "var(--text-muted)", fontWeight: 500, letterSpacing: "0.05em" }}>
              IN ROOM ({participants.length + 1})
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 10 }}>
              <ParticipantCard name={user.displayName || "You"} photoURL={user.photoURL} isSelf muted={muted} speaking={speaking && !muted} />
              {participants.map((p) => (
                <ParticipantCard
                  key={p.socketId}
                  name={p.displayName}
                  photoURL={p.photoURL}
                  isNew={justJoined.has(p.socketId)}
                  connectionStatus={peerStatus[p.socketId]}
                />
              ))}
            </div>
          </div>

          {/* Live Chat */}
          <div className="card" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 12, marginBottom: 12, color: "var(--text-muted)", fontWeight: 500, letterSpacing: "0.05em" }}>CHAT</h2>
            <div style={{ maxHeight: "min(240px, 35vh)", overflowY: "auto", marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {messages.length === 0 && (
                <p style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: "16px 0" }}>No messages yet</p>
              )}
              {messages.map((msg, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  {msg.photoURL ? (
                    <img src={msg.photoURL} alt="" style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                      {(msg.sender || "?")[0].toUpperCase()}
                    </div>
                  )}
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--primary)", marginRight: 6 }}>{msg.sender}</span>
                    <span style={{ fontSize: 13, color: "var(--text)" }}>{msg.text}</span>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={sendChat} style={{ display: "flex", gap: 8 }}>
              <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Type a message..." style={{ flex: 1 }} />
              <button className="btn-primary" type="submit" style={{ padding: "8px 16px", fontSize: 13 }}>Send</button>
            </form>
          </div>

          {/* Debug Log */}
          <div style={{ marginTop: 16, padding: 12, background: "rgba(0,0,0,0.5)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.05)" }}>
            <h3 style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.05em" }}>CONNECTION LOG</h3>
            <div style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)", maxHeight: 150, overflowY: "auto" }}>
              {debugLog.length === 0 ? <div>No events yet</div> : debugLog.map((line, i) => (
                <div key={i} style={{ color: line.includes("ERROR") || line.includes("failed") ? "var(--danger)" : line.includes("CONNECTED") || line.includes("playing") ? "var(--success)" : "var(--text-muted)" }}>{line}</div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ParticipantCard({ name, photoURL, isSelf, muted, speaking, isNew, connectionStatus }) {
  const isActive = speaking && !muted;
  return (
    <div
      style={{
        background: isActive ? "rgba(47, 158, 68, 0.06)" : "rgba(22, 27, 36, 0.5)",
        borderRadius: 10, padding: "16px 10px", textAlign: "center",
        border: isActive ? "1px solid rgba(47, 158, 68, 0.3)" : isSelf ? "1px solid rgba(59, 91, 219, 0.2)" : "1px solid transparent",
        transition: "all 0.2s",
        animation: isNew ? "joinPop 0.4s ease-out" : "none",
      }}
    >
      {photoURL ? (
        <img src={photoURL} alt="" style={{
          width: 44, height: 44, borderRadius: "50%", margin: "0 auto 8px", display: "block",
          border: isActive ? "2px solid var(--success)" : isSelf ? "2px solid var(--primary)" : "2px solid var(--border)",
          animation: isActive ? "speakPulse 1.2s infinite" : "none",
        }} />
      ) : (
        <div style={{
          width: 44, height: 44, borderRadius: "50%",
          background: isActive ? "linear-gradient(135deg, #2f9e44, #1a7a30)" : isSelf ? "linear-gradient(135deg, #3b5bdb, #2b4bc4)" : "var(--border)",
          display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 8px",
          fontSize: 18, fontWeight: 700, color: "#fff",
          animation: isActive ? "speakPulse 1.2s infinite" : "none", transition: "background 0.2s",
        }}>
          {(name || "?")[0].toUpperCase()}
        </div>
      )}
      <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name}
      </div>
      {isSelf && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>You</div>}
      {isSelf && muted && <div style={{ fontSize: 10, color: "var(--danger)", marginTop: 4 }}>Muted</div>}
      {isActive && <div style={{ fontSize: 10, color: "var(--success)", marginTop: 4, animation: "glowPulse 1.5s infinite" }}>Speaking</div>}
      {!isSelf && connectionStatus === "connecting" && (
        <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4 }}>Connecting...</div>
      )}
      {!isSelf && connectionStatus === "failed" && (
        <div style={{ fontSize: 9, color: "var(--danger)", marginTop: 4 }}>No connection</div>
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
