"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { getRoom, joinRoom, getTurnCredentials } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import SimplePeer from "simple-peer";
import DebatePanel from "@/components/DebatePanel";
import WinnerReveal from "@/components/WinnerReveal";

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;

function MessageText({ text }) {
  const parts = [];
  let lastIndex = 0;
  let match;
  const regex = new RegExp(URL_REGEX.source, "gi");
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={lastIndex}>{text.slice(lastIndex, match.index)}</span>);
    }
    parts.push(
      <a
        key={match.index}
        href={match[0]}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--primary-hover)", textDecoration: "underline", wordBreak: "break-all" }}
      >
        {match[0]}
      </a>
    );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={lastIndex}>{text.slice(lastIndex)}</span>);
  }
  return <>{parts}</>;
}

function UrlPreviewCard({ preview }) {
  if (!preview) return null;

  if (preview.type === "twitter" && preview.twitterHtml) {
    return (
      <a href={preview.url} target="_blank" rel="noopener noreferrer" className="url-preview-card" style={{ textDecoration: "none" }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{preview.siteName}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 2 }}>{preview.title}</div>
        {preview.description && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{preview.description}</div>}
        <div
          style={{ marginTop: 8, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}
          dangerouslySetInnerHTML={{ __html: preview.twitterHtml }}
        />
      </a>
    );
  }

  return (
    <a href={preview.url} target="_blank" rel="noopener noreferrer" className="url-preview-card" style={{ textDecoration: "none" }}>
      {preview.image && (
        <img
          src={preview.image}
          alt=""
          style={{ width: "100%", maxHeight: 160, objectFit: "cover", borderRadius: 6, marginBottom: 8 }}
          onError={(e) => { e.target.style.display = "none"; }}
        />
      )}
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>{preview.siteName || new URL(preview.url).hostname}</div>
      {preview.title && <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 2 }}>{preview.title}</div>}
      {preview.description && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
          {preview.description.length > 120 ? preview.description.slice(0, 120) + "…" : preview.description}
        </div>
      )}
    </a>
  );
}

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
  const [reactions, setReactions] = useState([]); // [{ id, targetUserId, type, timestamp }]
  const [roomMode, setRoomMode] = useState("casual");
  const [debateSession, setDebateSession] = useState(null);
  const [debateWinner, setDebateWinner] = useState(null);
  const [debateError, setDebateError] = useState(null);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteVideos, setRemoteVideos] = useState({}); // { socketId: MediaStream }
  const [selfVideoStream, setSelfVideoStream] = useState(null);
  const [screenShareInfo, setScreenShareInfo] = useState(null); // { socketId, displayName, stream }
  const [micVolume, setMicVolume] = useState(1.0);
  const [mediaVolume, setMediaVolume] = useState(1.0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [joinRole, setJoinRole] = useState(null); // null | "speaker" | "listener"
  const [floorMode, setFloorMode] = useState("open"); // "open" | "moderated"

  const peersRef = useRef({});
  const streamRef = useRef(null);
  const videoStreamRef = useRef(null);
  const socketRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const chatEndRef = useRef(null);
  const iceServersRef = useRef(null);
  const micVolumeRef = useRef(1.0);
  const mediaVolumeRef = useRef(1.0);
  const mediaRecorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const recordingCtxRef = useRef(null);

  const cleanupPeers = useCallback(() => {
    Object.values(peersRef.current).forEach((peer) => {
      if (peer && !peer.destroyed) peer.destroy();
    });
    peersRef.current = {};
    setPeerStatus({});
  }, []);

  const cleanup = useCallback(() => {
    cleanupPeers();
    // Stop recording if active
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (recordingCtxRef.current) { recordingCtxRef.current.close(); recordingCtxRef.current = null; }
    setIsRecording(false);
    setRecordingTime(0);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop());
      videoStreamRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
    }
    setConnected(false);
    setSpeaking(false);
    setVideoEnabled(false);
    setScreenSharing(false);
    setSelfVideoStream(null);
    setRemoteVideos({});
    setScreenShareInfo(null);
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

    console.log(`Creating peer to ${targetSocketId.slice(0,6)}… initiator=${initiator}`);
    setPeerStatus((prev) => ({ ...prev, [targetSocketId]: "connecting" }));

    const iceConfig = iceServersRef.current || [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ];
    console.log(`ICE servers: ${iceConfig.length} (${iceConfig.some(s => s.urls?.toString().includes("turn")) ? "TURN+STUN" : "STUN only"})`);

    const peer = new SimplePeer({
      initiator,
      stream,
      trickle: true,
      config: { iceServers: iceConfig },
    });

    // Monitor ICE connection state
    peer._pc?.addEventListener?.("iceconnectionstatechange", () => {
      const state = peer._pc?.iceConnectionState;
      console.log(`ICE state: ${state}`);
      if (state === "connected" || state === "completed") {
        setPeerStatus((prev) => ({ ...prev, [targetSocketId]: "connected" }));
      } else if (state === "failed" || state === "disconnected") {
        setPeerStatus((prev) => ({ ...prev, [targetSocketId]: "failed" }));
      }
    });

    peer.on("signal", (signal) => {
      console.log(`Signal OUT: ${signal.type || "candidate"}`);
      socketRef.current?.emit("signal", { targetSocketId, signal });
    });

    // Helper to handle incoming media (used by both "stream" and "track" events)
    const handleRemoteMedia = (remoteStream) => {
      const hasVideo = remoteStream.getVideoTracks().length > 0;
      const hasAudio = remoteStream.getAudioTracks().length > 0;
      console.log(`Got media: ${remoteStream.getAudioTracks().length} audio, ${remoteStream.getVideoTracks().length} video, id=${remoteStream.id}`);

      // Play audio — use stream ID so multiple streams (mic + screen share) can play simultaneously
      if (hasAudio) {
        const audioElId = `audio-${targetSocketId}-${remoteStream.id}`;
        const existing = document.getElementById(audioElId);
        if (!existing) {
          const audioType = hasVideo ? "screenshare" : "mic";
          const audio = document.createElement("audio");
          audio.id = audioElId;
          audio.setAttribute("playsinline", "");
          audio.setAttribute("data-audio-type", audioType);
          audio.volume = audioType === "screenshare" ? mediaVolumeRef.current : micVolumeRef.current;
          document.body.appendChild(audio);
          audio.srcObject = remoteStream;

          let retries = 0;
          const tryPlay = () => {
            audio.play().then(() => console.log(`Audio playing (${audioElId})!`))
              .catch((e) => { if (retries < 10) { retries++; setTimeout(tryPlay, 300); } });
          };
          tryPlay();

          // Clean up audio element when stream tracks end
          remoteStream.getAudioTracks().forEach((track) => {
            track.onended = () => {
              const el = document.getElementById(audioElId);
              if (el) el.remove();
            };
          });
        }
      }

      // Handle video track if present
      if (hasVideo) {
        setRemoteVideos((prev) => ({ ...prev, [targetSocketId]: remoteStream }));
      }
    };

    peer.on("stream", (remoteStream) => {
      handleRemoteMedia(remoteStream);
    });

    // "track" event fires reliably for dynamically added tracks (camera/screen share toggled mid-session)
    peer.on("track", (track, stream) => {
      console.log(`Got track: kind=${track.kind}, streamId=${stream.id}`);
      handleRemoteMedia(stream);

      // When a video track ends (camera/screen share stopped), remove from remoteVideos
      if (track.kind === "video") {
        track.onended = () => {
          setRemoteVideos((prev) => {
            const updated = { ...prev };
            // Only remove if this stream is still the current one for this peer
            if (updated[targetSocketId]?.id === stream.id) delete updated[targetSocketId];
            return updated;
          });
        };
      }
    });

    peer.on("connect", () => {
      console.log("P2P CONNECTED");
      setPeerStatus((prev) => ({ ...prev, [targetSocketId]: "connected" }));
    });

    peer.on("close", () => {
      console.log("Peer closed");
      // Remove all audio elements for this peer
      document.querySelectorAll(`[id^="audio-${targetSocketId}-"]`).forEach((el) => el.remove());
      delete peersRef.current[targetSocketId];
      setPeerStatus((prev) => { const n = { ...prev }; delete n[targetSocketId]; return n; });
      setRemoteVideos((prev) => { const n = { ...prev }; delete n[targetSocketId]; return n; });
      setScreenShareInfo((prev) => prev?.socketId === targetSocketId ? null : prev);
    });

    peer.on("error", (err) => {
      console.log(`Peer ERROR: ${err.message}`);
      setPeerStatus((prev) => ({ ...prev, [targetSocketId]: "failed" }));
      // Remove all audio elements for this peer
      document.querySelectorAll(`[id^="audio-${targetSocketId}-"]`).forEach((el) => el.remove());
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

  const joinVoice = useCallback(async (role) => {
    if (!user) return;

    try {
      // Resume AudioContext on user gesture (iOS)
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === "suspended") await ctx.resume();
        ctx.close();
      } catch (e) {}

      // Fetch TURN credentials from backend
      console.log("Fetching ICE servers...");
      try {
        const { iceServers } = await getTurnCredentials();
        iceServersRef.current = iceServers;
        console.log(`Got ${iceServers.length} ICE servers`);
      } catch (e) {
        console.log("TURN fetch failed, STUN only");
        iceServersRef.current = [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ];
      }

      let stream;
      if (role === "listener") {
        // Listeners don't send audio — create a silent stream for peer connections
        const silentCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = silentCtx.createOscillator();
        const gain = silentCtx.createGain();
        gain.gain.value = 0;
        const silentDest = silentCtx.createMediaStreamDestination();
        oscillator.connect(gain);
        gain.connect(silentDest);
        oscillator.start();
        stream = silentDest.stream;
        streamRef.current = stream;
      } else {
        // Speaker — use raw mic stream to preserve browser echo cancellation
        const rawMicStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
          video: false,
        });
        stream = rawMicStream;
        streamRef.current = stream;
        startSpeakingDetection(rawMicStream);
      }

      // Socket setup — remove old listeners first
      const socket = getSocket();
      socketRef.current = socket;
      socket.removeAllListeners();

      if (socket.connected) socket.disconnect();
      socket.connect();

      socket.on("connect", () => {
        console.log(`Socket connected: ${socket.id?.slice(0,6)}…`);
        socket.emit("join-room", {
          roomId,
          userId: user.uid,
          displayName: user.displayName || user.email,
          photoURL: user.photoURL || null,
          createdBy: room?.created_by || null,
          role: role,
        });
      });

      socket.on("existing-users", (users) => {
        console.log(`Existing users: ${users.length}`);
        setParticipants(users);
        users.forEach((u) => createPeer(u.socketId, true, stream));
      });

      socket.on("user-connected", (newUser) => {
        console.log(`User joined: ${newUser.displayName}`);
        setParticipants((prev) => [...prev, newUser]);
        createPeer(newUser.socketId, false, stream);
        setJustJoined((prev) => new Set([...prev, newUser.socketId]));
        setTimeout(() => {
          setJustJoined((prev) => { const next = new Set(prev); next.delete(newUser.socketId); return next; });
        }, 1500);
      });

      socket.on("signal", ({ fromSocketId, signal }) => {
        console.log(`Signal IN: ${signal.type || "candidate"} from ${fromSocketId?.slice(0,6)}…`);
        let peer = peersRef.current[fromSocketId];
        if (!peer || peer.destroyed) {
          console.log("Signal from unknown peer, creating responder");
          peer = createPeer(fromSocketId, false, stream);
        }
        peer.signal(signal);
      });

      socket.on("user-disconnected", ({ socketId }) => {
        const peer = peersRef.current[socketId];
        if (peer && !peer.destroyed) peer.destroy();
        delete peersRef.current[socketId];
        // Remove all audio elements for this peer
        document.querySelectorAll(`[id^="audio-${socketId}-"]`).forEach((el) => el.remove());
        setParticipants((prev) => prev.filter((p) => p.socketId !== socketId));
        setPeerStatus((prev) => { const n = { ...prev }; delete n[socketId]; return n; });
      });

      socket.on("chat-message", (msg) => {
        setMessages((prev) => [...prev, msg]);
      });

      // Kick/ban listeners
      socket.on("kicked", () => {
        cleanup();
        alert("You were removed from this room.");
        router.push("/");
      });

      socket.on("join-denied", ({ reason }) => {
        if (reason === "banned") {
          setError("You have been banned from this room.");
        } else {
          setError("Unable to join room.");
        }
      });

      // Reaction listener
      socket.on("reaction", ({ targetUserId, type, timestamp }) => {
        const id = `${targetUserId}-${type}-${timestamp}`;
        setReactions((prev) => [...prev, { id, targetUserId, type, timestamp }]);
        setTimeout(() => {
          setReactions((prev) => prev.filter((r) => r.id !== id));
        }, 2000);
      });

      // AI fact-check response listener
      socket.on("ai-response", (result) => {
        setMessages((prev) => [...prev, {
          sender: "BACKCHANNEL AI",
          isAI: true,
          text: result.text,
          originalQuery: result.originalQuery,
          type: result.type,
          timestamp: Date.now(),
        }]);
      });

      // URL preview listener — attach preview to the matching message
      socket.on("url-preview", ({ text, timestamp, preview }) => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.text === text && !msg.urlPreview && Math.abs(msg.timestamp - timestamp) < 5000
              ? { ...msg, urlPreview: preview }
              : msg
          )
        );
      });

      // ─── Debate Mode Listeners ────────────────────────────────
      socket.on("room-mode-change", ({ mode, session }) => {
        setRoomMode(mode);
        setDebateSession(mode === "debate" ? session : null);
        if (mode === "casual") { setDebateWinner(null); setDebateError(null); }
      });

      socket.on("debate-update", (session) => {
        setDebateSession(session);
      });

      socket.on("debate-scoreboard", (scoreboard) => {
        setDebateSession((prev) => prev ? { ...prev, scores: scoreboard.scores } : prev);
      });

      socket.on("debate-winner", (winner) => {
        setDebateWinner(winner);
      });

      socket.on("debate-error", ({ message }) => {
        setDebateError(message);
        setTimeout(() => setDebateError(null), 4000);
      });

      // Video / Screen Share presence signals
      socket.on("user-screen-share", ({ userId: uid, screenSharing: sharing, displayName: name }) => {
        if (sharing) {
          // Find the socketId for this userId
          setParticipants((prev) => {
            const p = prev.find((u) => u.userId === uid);
            if (p) setScreenShareInfo((si) => ({ socketId: p.socketId, displayName: name || p.displayName }));
            return prev;
          });
        } else {
          setScreenShareInfo((prev) => {
            // Clear if it was this user sharing
            const match = participants.find((u) => u.userId === uid);
            if (match && prev?.socketId === match.socketId) return null;
            return prev;
          });
        }
      });

      // Floor mode & role change listeners
      socket.on("floor-mode", ({ mode }) => {
        setFloorMode(mode);
      });

      socket.on("role-changed", ({ userId: uid, socketId: sid, role: newRole }) => {
        // Update participant role
        setParticipants((prev) => prev.map((p) => p.userId === uid ? { ...p, role: newRole } : p));
        // If it's us being promoted/demoted
        if (uid === user.uid) {
          setJoinRole(newRole);
        }
      });

      socket.on("disconnect", (reason) => {
        console.log(`Socket disconnected: ${reason}`);
      });

      setConnected(true);
    } catch (err) {
      console.error("Failed to join voice:", err);
      setError("Could not access microphone. Please allow mic access and try again.");
    }
  }, [user, roomId, room, createPeer, startSpeakingDetection, cleanup, router]);

  useEffect(() => cleanup, [cleanup]);

  // Trigger joinVoice when role is selected
  useEffect(() => {
    if (joinRole && !connected) {
      joinVoice(joinRole);
    }
  }, [joinRole]);

  // Sync voice volume — controls how loud you hear other users' mics
  useEffect(() => {
    micVolumeRef.current = micVolume;
    document.querySelectorAll('[data-audio-type="mic"]').forEach((el) => {
      el.volume = micVolume;
    });
  }, [micVolume]);

  // Sync media volume — controls screen share audio only
  useEffect(() => {
    mediaVolumeRef.current = mediaVolume;
    document.querySelectorAll('[data-audio-type="screenshare"]').forEach((el) => {
      el.volume = mediaVolume;
    });
  }, [mediaVolume]);

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

  const kickUser = (targetUserId) => {
    if (!socketRef.current) return;
    socketRef.current.emit("kick-user", { roomId, targetUserId });
  };

  const sendReaction = (targetUserId, type) => {
    if (!socketRef.current) return;
    socketRef.current.emit("reaction", { roomId, targetUserId, type });
  };

  const toggleVideo = useCallback(async () => {
    if (videoEnabled) {
      // Stop video — remove track from all peers via SimplePeer API
      if (videoStreamRef.current) {
        const tracks = videoStreamRef.current.getTracks();
        Object.values(peersRef.current).forEach((peer) => {
          if (peer && !peer.destroyed) {
            tracks.forEach((track) => {
              try { peer.removeTrack(track, videoStreamRef.current); } catch (e) {}
            });
          }
        });
        tracks.forEach((t) => t.stop());
        videoStreamRef.current = null;
      }
      setSelfVideoStream(null);
      setVideoEnabled(false);
      socketRef.current?.emit("user-video-toggle", { roomId, videoEnabled: false });
    } else {
      try {
        const vidStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: "user" },
        });
        videoStreamRef.current = vidStream;
        setSelfVideoStream(vidStream);
        setVideoEnabled(true);
        // Add video track to all peers via SimplePeer API (triggers renegotiation)
        const videoTrack = vidStream.getVideoTracks()[0];
        Object.values(peersRef.current).forEach((peer) => {
          if (peer && !peer.destroyed) {
            try { peer.addTrack(videoTrack, vidStream); } catch (e) { console.error("addTrack failed:", e); }
          }
        });
        socketRef.current?.emit("user-video-toggle", { roomId, videoEnabled: true });
      } catch (e) {
        console.error("Camera access failed:", e);
      }
    }
  }, [videoEnabled, roomId]);

  const toggleScreenShare = useCallback(async () => {
    if (screenSharing) {
      // Stop screen share — remove all tracks from peers via SimplePeer API
      if (videoStreamRef.current) {
        const tracks = videoStreamRef.current.getTracks();
        Object.values(peersRef.current).forEach((peer) => {
          if (peer && !peer.destroyed) {
            tracks.forEach((track) => {
              try { peer.removeTrack(track, videoStreamRef.current); } catch (e) {}
            });
          }
        });
        tracks.forEach((t) => t.stop());
        videoStreamRef.current = null;
      }
      setSelfVideoStream(null);
      setScreenSharing(false);
      setScreenShareInfo(null);
      socketRef.current?.emit("user-screen-share", { roomId, screenSharing: false });
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        videoStreamRef.current = screenStream;
        setSelfVideoStream(screenStream);
        setScreenSharing(true);
        setVideoEnabled(false); // Screen share replaces camera

        // Add ALL tracks (video + audio) to peers via SimplePeer API (triggers renegotiation)
        const allTracks = screenStream.getTracks();
        Object.values(peersRef.current).forEach((peer) => {
          if (peer && !peer.destroyed) {
            allTracks.forEach((track) => {
              try { peer.addTrack(track, screenStream); } catch (e) { console.error("addTrack failed:", e); }
            });
          }
        });

        // Auto-stop when user clicks "Stop sharing" in browser UI
        screenStream.getVideoTracks()[0].onended = () => {
          const tracks = screenStream.getTracks();
          Object.values(peersRef.current).forEach((peer) => {
            if (peer && !peer.destroyed) {
              tracks.forEach((track) => {
                try { peer.removeTrack(track, screenStream); } catch (e) {}
              });
            }
          });
          tracks.forEach((t) => t.stop());
          setScreenSharing(false);
          setSelfVideoStream(null);
          setScreenShareInfo(null);
          videoStreamRef.current = null;
          socketRef.current?.emit("user-screen-share", { roomId, screenSharing: false });
        };

        socketRef.current?.emit("user-screen-share", { roomId, screenSharing: true, displayName: user.displayName });
      } catch (e) {
        console.error("Screen share failed:", e);
      }
    }
  }, [screenSharing, roomId, user]);

  const startRecording = useCallback(() => {
    try {
      const mixCtx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = mixCtx.createMediaStreamDestination();
      recordingCtxRef.current = mixCtx;

      // Mix own mic
      if (streamRef.current) {
        const micSource = mixCtx.createMediaStreamSource(streamRef.current);
        micSource.connect(dest);
      }

      // Mix all remote audio
      document.querySelectorAll('[id^="audio-"]').forEach((audioEl) => {
        if (audioEl.srcObject) {
          try {
            const remoteSource = mixCtx.createMediaStreamSource(audioEl.srcObject);
            remoteSource.connect(dest);
          } catch (e) { /* stream may already be ended */ }
        }
      });

      const recorder = new MediaRecorder(dest.stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus" : "audio/webm",
      });
      recordingChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordingChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `backchannel-${roomId}-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        recordingChunksRef.current = [];
      };
      mediaRecorderRef.current = recorder;
      recorder.start(1000);

      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
      setIsRecording(true);
    } catch (e) {
      console.error("Recording failed:", e);
    }
  }, [roomId]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (recordingCtxRef.current) { recordingCtxRef.current.close(); recordingCtxRef.current = null; }
    setIsRecording(false);
    setRecordingTime(0);
  }, []);

  const isCreator = room?.created_by === user?.uid;

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
    <div className={`container${roomMode === "debate" && debateSession?.status === "active" ? " debate-active" : ""}`}>
      {/* Header */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28, paddingTop: 12, flexWrap: "wrap", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: "0.04em", textShadow: "0 0 16px rgba(250, 204, 21, 0.4), 0 0 32px rgba(250, 204, 21, 0.15)" }}>BACKCHANNEL</span>
            {room?.vibe && VIBES[room.vibe] && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
                background: VIBES[room.vibe].color + "20", color: VIBES[room.vibe].color,
                letterSpacing: "0.05em",
                animation: room.vibe === "breaking" ? "breakingPulse 2s infinite" : "none",
              }}>{VIBES[room.vibe].label}</span>
            )}
            {/* Mode indicator */}
            {connected && roomMode === "debate" && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
                background: "rgba(224, 49, 49, 0.15)", color: "var(--danger)",
                letterSpacing: "0.05em",
              }}>DEBATE MODE</span>
            )}
          </div>
          <h1 style={{ fontSize: "clamp(22px, 6vw, 30px)", fontWeight: 800, color: "#fff", letterSpacing: "-1px", wordBreak: "break-word" }}>{room?.title || "Loading..."}</h1>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            <code style={{ background: "rgba(22, 27, 36, 0.8)", padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>{roomId}</code>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          {/* Mode Toggle — creator only */}
          {connected && isCreator && (
            <button
              className={`mode-toggle ${roomMode}`}
              disabled={debateSession?.status === "active" || debateSession?.status === "judging"}
              onClick={() => {
                if (roomMode === "casual") {
                  socketRef.current?.emit("enable-debate-mode", { roomId, config: {} });
                } else {
                  socketRef.current?.emit("disable-debate-mode", { roomId });
                }
              }}
              title={
                (debateSession?.status === "active" || debateSession?.status === "judging")
                  ? "Cannot switch mode during active debate"
                  : roomMode === "casual" ? "Enable Debate Mode" : "Back to Casual"
              }
            >
              {roomMode === "casual" ? "⚔️ Debate" : "💬 Casual"}
            </button>
          )}
          <button className="btn-outline" onClick={shareRoom} style={{ padding: "8px 14px", fontSize: 12 }}>
            {copied ? "Copied" : "Share"}
          </button>
          <button className="btn-danger" onClick={leaveRoom} style={{ padding: "8px 14px", fontSize: 12 }}>Leave</button>
        </div>
      </header>

      {!connected ? (
        <div className="card" style={{ textAlign: "center", padding: "56px 28px" }}>
          <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.15 }}><MicOnIcon size={48} /></div>
          {!joinRole ? (
            <>
              <p style={{ marginBottom: 28, color: "var(--text-muted)", fontSize: 15 }}>How do you want to join?</p>
              <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
                <button className="btn-primary" onClick={() => { setJoinRole("speaker"); }} style={{ fontSize: 16, padding: "16px 40px", borderRadius: 10 }}>
                  Join Voice
                </button>
                <button className="btn-outline" onClick={() => { setJoinRole("listener"); }} style={{ fontSize: 16, padding: "16px 40px", borderRadius: 10, border: "1px solid var(--border)" }}>
                  Listen Only
                </button>
              </div>
            </>
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Connecting as {joinRole}...</p>
          )}
        </div>
      ) : (
        <>
          {/* Media Controls */}
          <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 16, padding: "16px" }}>
            {joinRole === "listener" && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Listening mode — you are muted</div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {joinRole !== "listener" && (
                <button
                  onClick={toggleMute}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "10px 20px",
                    background: muted ? "transparent" : "var(--primary)",
                    border: muted ? "1px solid rgba(224, 49, 49, 0.3)" : "none",
                    color: muted ? "var(--danger)" : "#fff", borderRadius: 8, fontSize: 12,
                  }}
                >
                  {muted ? <><MicOffIcon /> Unmute</> : <><MicOnIcon /> Mute</>}
                </button>
              )}
              {joinRole !== "listener" && (
                <>
                  <button
                    onClick={toggleVideo}
                    className={`media-btn${videoEnabled ? " active" : ""}`}
                    title={videoEnabled ? "Turn off camera" : "Turn on camera"}
                  >
                    <VideoIcon /> {videoEnabled ? "Cam On" : "Cam"}
                  </button>
                  <button
                    onClick={toggleScreenShare}
                    className={`media-btn${screenSharing ? " screen-active" : ""}`}
                    title={screenSharing ? "Stop sharing" : "Share screen"}
                  >
                    <ScreenIcon /> {screenSharing ? "Sharing" : "Screen"}
                  </button>
                </>
              )}
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`media-btn${isRecording ? " recording-active" : ""}`}
                title={isRecording ? "Stop recording" : "Record audio"}
              >
                <RecordIcon /> {isRecording ? `${Math.floor(recordingTime / 60)}:${(recordingTime % 60).toString().padStart(2, "0")}` : "Record"}
              </button>
            </div>
            {/* Volume Sliders */}
            <div className="volume-controls">
              <div className="volume-row">
                <MicOnIcon />
                <span className="volume-label">Voices</span>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={micVolume}
                  onChange={(e) => setMicVolume(parseFloat(e.target.value))}
                  className="volume-slider mic-slider"
                />
                <span className="volume-value">{Math.round(micVolume * 100)}%</span>
              </div>
              <div className="volume-row">
                <ScreenIcon />
                <span className="volume-label">Media</span>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={mediaVolume}
                  onChange={(e) => setMediaVolume(parseFloat(e.target.value))}
                  className="volume-slider media-slider"
                />
                <span className="volume-value">{Math.round(mediaVolume * 100)}%</span>
              </div>
            </div>
            {/* Host Floor Mode Toggle */}
            {isCreator && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Floor:</span>
                <button
                  onClick={() => {
                    const newMode = floorMode === "open" ? "moderated" : "open";
                    socketRef.current?.emit("set-floor-mode", { roomId, mode: newMode });
                  }}
                  className={`media-btn${floorMode === "moderated" ? " active" : ""}`}
                  style={{ padding: "4px 12px", fontSize: 11 }}
                >
                  {floorMode === "open" ? "Open Floor" : "Moderated"}
                </button>
              </div>
            )}
            {participants.length > 0 && (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {(() => {
                  const speakerCount = participants.filter((p) => p.role !== "listener").length + (joinRole === "speaker" ? 1 : 0);
                  const listenerCount = participants.filter((p) => p.role === "listener").length + (joinRole === "listener" ? 1 : 0);
                  return (
                    <>
                      <span style={{ color: "var(--success)" }}>{speakerCount} speaking</span>
                      {listenerCount > 0 && <span style={{ marginLeft: 8 }}>{listenerCount} listening</span>}
                    </>
                  );
                })()}
                {failedPeers > 0 && (
                  <span style={{ color: "var(--danger)", marginLeft: 8 }}>{failedPeers} failed</span>
                )}
              </div>
            )}
          </div>

          {/* Screen Share Spotlight */}
          {screenShareInfo && remoteVideos[screenShareInfo.socketId] && (
            <div className="spotlight-area">
              <VideoElement stream={remoteVideos[screenShareInfo.socketId]} className="spotlight-video" />
              <div className="spotlight-label">{screenShareInfo.displayName} is sharing their screen</div>
            </div>
          )}
          {/* Self screen share spotlight */}
          {screenSharing && selfVideoStream && (
            <div className="spotlight-area">
              <VideoElement stream={selfVideoStream} className="spotlight-video" muted />
              <div className="spotlight-label">You are sharing your screen</div>
            </div>
          )}

          {/* Participants */}
          <div className="card">
            <h2 style={{ fontSize: 13, marginBottom: 20, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.06em" }}>
              IN ROOM ({participants.length + 1})
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 10 }}>
              <ParticipantCard name={user.displayName || "You"} photoURL={user.photoURL} isSelf muted={muted} speaking={speaking && !muted} videoStream={videoEnabled && selfVideoStream && !screenSharing ? selfVideoStream : null} reactions={reactions.filter((r) => r.targetUserId === user.uid)} role={joinRole} />
              {participants.map((p) => (
                <ParticipantCard
                  key={p.socketId}
                  name={p.displayName}
                  photoURL={p.photoURL}
                  userId={p.userId}
                  isNew={justJoined.has(p.socketId)}
                  connectionStatus={peerStatus[p.socketId]}
                  isCreator={isCreator}
                  onKick={() => kickUser(p.userId)}
                  onReaction={(type) => sendReaction(p.userId, type)}
                  reactions={reactions.filter((r) => r.targetUserId === p.userId)}
                  videoStream={remoteVideos[p.socketId] || null}
                  role={p.role}
                  onPromote={isCreator && p.role === "listener" ? () => socketRef.current?.emit("promote-to-speaker", { roomId, targetUserId: p.userId }) : null}
                  onDemote={isCreator && p.role !== "listener" ? () => socketRef.current?.emit("demote-to-listener", { roomId, targetUserId: p.userId }) : null}
                />
              ))}
            </div>
          </div>

          {/* Debate Panel — only in debate mode */}
          {roomMode === "debate" && debateSession && (
            <DebatePanel
              session={debateSession}
              userId={user.uid}
              isCreator={isCreator}
              socket={socketRef.current}
              roomId={roomId}
              error={debateError}
            />
          )}

          {/* Live Chat */}
          <div className="card" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 13, marginBottom: 12, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.06em" }}>CHAT</h2>
            <div style={{ maxHeight: "min(240px, 35vh)", overflowY: "auto", marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {messages.length === 0 && (
                <p style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: "16px 0" }}>No messages yet</p>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={msg.isAI ? "ai-message" : ""} style={{
                  display: "flex", gap: 8, alignItems: "flex-start",
                  ...(msg.isAI ? {
                    background: "rgba(99, 102, 241, 0.08)",
                    border: "1px solid rgba(99, 102, 241, 0.2)",
                    borderRadius: 8, padding: "10px 12px",
                  } : {}),
                }}>
                  {msg.isAI ? (
                    <div style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}>🧠</div>
                  ) : msg.photoURL ? (
                    <img src={msg.photoURL} alt="" style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                      {(msg.sender || "?")[0].toUpperCase()}
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    {msg.isAI ? (
                      <>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(139, 92, 246, 0.9)", letterSpacing: "0.05em" }}>BACKCHANNEL AI</span>
                        {msg.originalQuery && (
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, fontStyle: "italic" }}>
                            Re: &quot;{msg.originalQuery}&quot;
                          </div>
                        )}
                        <div style={{ fontSize: 13, color: "var(--text)", marginTop: 4, lineHeight: 1.5 }}>
                          {msg.type === "error" ? (
                            <span style={{ color: "var(--danger)" }}>{msg.text}</span>
                          ) : msg.text}
                        </div>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--primary)", marginRight: 6 }}>{msg.sender}</span>
                        <span style={{ fontSize: 13, color: "var(--text)" }}><MessageText text={msg.text} /></span>
                        {msg.urlPreview && <UrlPreviewCard preview={msg.urlPreview} />}
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={sendChat} style={{ display: "flex", gap: 8 }}>
              <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Type a message... (/fact to fact-check)" style={{ flex: 1 }} />
              <button className="btn-primary" type="submit" style={{ padding: "10px 20px", fontSize: 14, flexShrink: 0 }}>Send</button>
            </form>
          </div>

        </>
      )}

      {/* Winner Reveal Overlay */}
      {debateWinner && (
        <WinnerReveal winner={debateWinner} onDismiss={() => setDebateWinner(null)} />
      )}
    </div>
  );
}

function VideoElement({ stream, className, muted: isMuted }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);
  return <video ref={videoRef} autoPlay playsInline muted={isMuted} className={className} />;
}

function ParticipantCard({ name, photoURL, userId, isSelf, muted, speaking, isNew, connectionStatus, isCreator, onKick, onReaction, reactions = [], videoStream, role, onPromote, onDemote }) {
  const isActive = speaking && !muted;
  const hasVideo = videoStream && videoStream.getVideoTracks().length > 0;
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        background: isActive ? "rgba(47, 158, 68, 0.06)" : "rgba(22, 27, 36, 0.5)",
        borderRadius: 10, padding: "16px 10px", textAlign: "center",
        border: isActive ? "1px solid rgba(47, 158, 68, 0.3)" : isSelf ? "1px solid rgba(59, 91, 219, 0.2)" : "1px solid transparent",
        transition: "all 0.2s",
        animation: isNew ? "joinPop 0.4s ease-out" : "none",
        position: "relative",
        overflow: "visible",
      }}
    >
      {/* Expanded self-video overlay */}
      {expanded && isSelf && hasVideo && (
        <div
          onClick={() => setExpanded(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 999,
            background: "rgba(8, 10, 16, 0.85)", backdropFilter: "blur(12px)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            cursor: "pointer", animation: "overlayFadeIn 200ms ease forwards",
          }}
        >
          <VideoElement stream={videoStream} className="self-video-expanded" muted />
          <div style={{ marginTop: 16, fontSize: 13, color: "var(--text-muted)" }}>Tap anywhere to close</div>
        </div>
      )}

      {/* Floating reaction emojis */}
      {reactions.map((r) => (
        <div key={r.id} className="reaction-float" style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", pointerEvents: "none", zIndex: 10 }}>
          <span style={{ fontSize: 24 }}>{{ fire: "🔥", cook: "🍳", laugh: "😂", thumbsup: "👍", mad: "😡", thumbsdown: "👎" }[r.type] || "🔥"}</span>
        </div>
      ))}

      {/* Video or avatar */}
      {hasVideo ? (
        <div onClick={isSelf ? () => setExpanded(true) : undefined} style={{ cursor: isSelf ? "pointer" : "default" }}>
          <VideoElement stream={videoStream} className={isSelf ? "self-video-preview" : "participant-video"} muted={isSelf} />
        </div>
      ) : photoURL ? (
        <img src={photoURL} alt="" style={{
          width: 52, height: 52, borderRadius: "50%", margin: "0 auto 8px", display: "block",
          border: isActive ? "2px solid var(--success)" : isSelf ? "2px solid var(--primary)" : "2px solid var(--border)",
          animation: isActive ? "speakPulse 1.2s infinite" : "none",
        }} />
      ) : (
        <div style={{
          width: 52, height: 52, borderRadius: "50%",
          background: isActive ? "linear-gradient(135deg, #2f9e44, #1a7a30)" : isSelf ? "linear-gradient(135deg, #3b5bdb, #2b4bc4)" : "var(--border)",
          display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 8px",
          fontSize: 20, fontWeight: 700, color: "#fff",
          animation: isActive ? "speakPulse 1.2s infinite" : "none", transition: "background 0.2s",
        }}>
          {(name || "?")[0].toUpperCase()}
        </div>
      )}
      <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name}
      </div>
      {isSelf && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>You{role === "listener" ? " (Listener)" : ""}</div>}
      {role === "listener" && !isSelf && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>Listener</div>}
      {isSelf && muted && role !== "listener" && <div style={{ fontSize: 10, color: "var(--danger)", marginTop: 4 }}>Muted</div>}
      {isActive && <div style={{ fontSize: 10, color: "var(--success)", marginTop: 4, animation: "glowPulse 1.5s infinite" }}>Speaking</div>}
      {!isSelf && connectionStatus === "connecting" && (
        <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4 }}>Connecting...</div>
      )}
      {!isSelf && connectionStatus === "failed" && (
        <div style={{ fontSize: 9, color: "var(--danger)", marginTop: 4 }}>No connection</div>
      )}

      {/* Reaction buttons (non-self only) */}
      {!isSelf && onReaction && (
        <div style={{ display: "flex", justifyContent: "center", gap: 3, marginTop: 6, flexWrap: "wrap" }}>
          {[
            { type: "fire", emoji: "🔥", title: "They're on fire!" },
            { type: "cook", emoji: "🍳", title: "They're cooking!" },
            { type: "laugh", emoji: "😂", title: "Hilarious!" },
            { type: "thumbsup", emoji: "👍", title: "Agree!" },
            { type: "thumbsdown", emoji: "👎", title: "Disagree!" },
            { type: "mad", emoji: "😡", title: "Angry!" },
          ].map((r) => (
            <button
              key={r.type}
              onClick={() => onReaction(r.type)}
              title={r.title}
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "2px 5px", fontSize: 13, cursor: "pointer", lineHeight: 1 }}
            >{r.emoji}</button>
          ))}
        </div>
      )}

      {/* Host controls (promote/demote/kick) */}
      {!isSelf && isCreator && (
        <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
          {onPromote && (
            <button onClick={onPromote} title="Promote to speaker" style={{
              background: "rgba(47, 158, 68, 0.1)", border: "1px solid rgba(47, 158, 68, 0.2)",
              borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "var(--success)", cursor: "pointer",
            }}>Speak</button>
          )}
          {onDemote && (
            <button onClick={onDemote} title="Move to listener" style={{
              background: "rgba(59, 91, 219, 0.1)", border: "1px solid rgba(59, 91, 219, 0.2)",
              borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "var(--primary)", cursor: "pointer",
            }}>Listen</button>
          )}
          {onKick && (
            <button onClick={onKick} title="Kick user" style={{
              background: "rgba(224, 49, 49, 0.1)", border: "1px solid rgba(224, 49, 49, 0.2)",
              borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "var(--danger)", cursor: "pointer",
            }}>Kick</button>
          )}
        </div>
      )}
    </div>
  );
}

function VideoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function ScreenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
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

function SpeakerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function RecordIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="6" fill="currentColor" />
    </svg>
  );
}
