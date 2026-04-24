"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { createRoom, listRooms, deleteRoom, getStats, listRoomsDiscovery } from "@/lib/api";

const VIBES = {
  chill: { color: "#6c5ce7", label: "CHILL" },
  debate: { color: "#e03131", label: "DEBATE" },
  truth: { color: "#f59f00", label: "TRUTH" },
  sport: { color: "#2f9e44", label: "SPORT" },
  music: { color: "#3b5bdb", label: "MUSIC" },
  breaking: { color: "#ff6b35", label: "BREAKING" },
};

function resizeImage(file, size) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function Dashboard() {
  const { user, loading, login, logout, editProfile, changeAvatar } = useAuth();
  const [title, setTitle] = useState("");
  const [vibe, setVibe] = useState("chill");
  const [joinId, setJoinId] = useState("");
  const [rooms, setRooms] = useState([]);
  const [showProfile, setShowProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profilePhoto, setProfilePhoto] = useState("");
  const [uploading, setUploading] = useState(false);
  const [activeUsers, setActiveUsers] = useState(0);
  const [discoveryRooms, setDiscoveryRooms] = useState([]);
  const [vibeFilter, setVibeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    getStats().then((s) => setActiveUsers(s.activeUsers)).catch(() => {});
  }, []);

  useEffect(() => {
    if (user) {
      listRooms().then(setRooms).catch(console.error);
    }
  }, [user]);

  // Discovery feed with polling
  const fetchDiscovery = useCallback(() => {
    if (!user) return;
    setDiscoveryLoading(true);
    listRoomsDiscovery(vibeFilter, searchQuery)
      .then(setDiscoveryRooms)
      .catch(console.error)
      .finally(() => setDiscoveryLoading(false));
  }, [user, vibeFilter, searchQuery]);

  useEffect(() => {
    fetchDiscovery();
    const interval = setInterval(fetchDiscovery, 10000);
    return () => clearInterval(interval);
  }, [fetchDiscovery]);

  if (loading) {
    return (
      <div className="container" style={{ textAlign: "center", marginTop: "min(160px, 20vh)" }}>
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  // Detect in-app browsers (Messenger, Instagram, Facebook, etc.)
  const isInAppBrowser = typeof navigator !== "undefined" && /FBAN|FBAV|Instagram|Messenger|Line|Snapchat|Twitter|MicroMessenger/i.test(navigator.userAgent);

  if (!user) {
    return (
      <div className="container" style={{ textAlign: "center", position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "40px 24px" }}>
        {/* Graffiti scattered text */}
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
          {["LIVE", "UNMUTED", "RAW", "TRUTH", "NO CAP", "ON AIR"].map((word, i) => (
            <span key={word} style={{
              position: "absolute",
              fontSize: [34, 22, 28, 24, 20, 26][i],
              fontWeight: 900,
              color: "#fff",
              opacity: 0.04,
              transform: `rotate(${[-12, 8, -5, 15, -8, 10][i]}deg)`,
              top: `${[10, 60, 30, 75, 45, 85][i]}%`,
              left: `${[5, 75, 60, 20, 85, 40][i]}%`,
              letterSpacing: "0.1em",
              userSelect: "none",
            }}>{word}</span>
          ))}
        </div>

        <div style={{ position: "relative", zIndex: 1 }}>
          <h1 style={{ fontSize: "clamp(52px, 16vw, 80px)", fontWeight: 900, letterSpacing: "-3px", marginBottom: 20, color: "#fff", textShadow: "0 0 30px rgba(250, 204, 21, 0.45), 0 0 60px rgba(250, 204, 21, 0.2), 0 2px 4px rgba(0,0,0,0.5)" }}>
            Backchannel
          </h1>
          <p style={{ color: "var(--text-muted)", marginBottom: 32, fontSize: "clamp(16px, 4.5vw, 20px)", fontWeight: 500, letterSpacing: "0.02em" }}>
            Drop in. Speak up. No recordings.
          </p>

          {/* Equalizer waveform */}
          <div style={{ display: "flex", justifyContent: "center", gap: 3, marginBottom: 48, height: 40, alignItems: "center" }}>
            {[0.3, 0.7, 0.5, 1.0, 0.4, 0.8, 0.6, 1.0, 0.3, 0.9, 0.5, 0.7, 0.4, 0.8, 0.6, 0.3, 0.9, 0.5, 0.7, 0.4].map((delay, i) => (
              <div key={i} style={{
                width: 2.5,
                height: `${12 + Math.sin(i * 0.8) * 12 + 8}px`,
                background: `rgba(59, 91, 219, ${0.3 + Math.sin(i * 0.6) * 0.2})`,
                borderRadius: 2,
                animation: `eqBar ${1.0 + delay * 0.5}s ease-in-out infinite`,
                animationDelay: `${delay * 0.25}s`,
                transformOrigin: "center",
              }} />
            ))}
          </div>

          {isInAppBrowser ? (
            <div style={{ maxWidth: 380, margin: "0 auto" }}>
              <p style={{ color: "#f59f00", fontSize: 15, fontWeight: 600, marginBottom: 14 }}>
                Open in your browser to sign in
              </p>
              <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
                Google sign-in doesn't work inside app browsers. Tap the menu (
                <span style={{ fontWeight: 700 }}>...</span> or
                <span style={{ fontWeight: 700 }}> share</span>) and choose
                <span style={{ color: "#fff", fontWeight: 600 }}> "Open in Safari"</span> or
                <span style={{ color: "#fff", fontWeight: 600 }}> "Open in Chrome"</span>.
              </p>
              <button
                className="btn-primary"
                onClick={() => {
                  window.open(window.location.href, "_system");
                }}
                style={{ fontSize: 15, padding: "14px 40px", borderRadius: 10 }}
              >
                Try Opening in Browser
              </button>
            </div>
          ) : (
            <button className="btn-primary" onClick={login} style={{
              fontSize: 16, padding: "18px 56px", borderRadius: 12,
              background: "linear-gradient(135deg, #3b5bdb 0%, #4c6ef5 100%)",
              boxShadow: "0 0 20px rgba(59, 91, 219, 0.3), 0 4px 20px rgba(0,0,0,0.3)",
              transition: "all 0.3s",
            }}>
              Sign in with Google
            </button>
          )}

          {activeUsers > 0 && (
            <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 32 }}>
              <span style={{ color: "var(--success)", fontWeight: 600 }}>{activeUsers}</span> people talking right now
            </p>
          )}
        </div>
      </div>
    );
  }

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    const { roomId } = await createRoom(title.trim(), user.uid, vibe);
    router.push(`/room/${roomId}`);
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!joinId.trim()) return;
    router.push(`/room/${joinId.trim()}`);
  };

  const handleDelete = async (roomId) => {
    if (!confirm("Delete this room?")) return;
    await deleteRoom(roomId, user.uid);
    setRooms((prev) => prev.filter((r) => r.id !== roomId));
  };

  return (
    <div className="container">
      {/* Graffiti texture on dashboard too */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
        {["LIVE", "RAW", "NO CAP", "ON AIR"].map((word, i) => (
          <span key={word} style={{
            position: "absolute",
            fontSize: [22, 18, 16, 20][i],
            fontWeight: 900,
            color: "#fff",
            opacity: 0.025,
            transform: `rotate(${[-8, 12, -5, 7][i]}deg)`,
            top: `${[15, 55, 80, 35][i]}%`,
            left: `${[8, 80, 50, 70][i]}%`,
            letterSpacing: "0.1em",
            userSelect: "none",
          }}>{word}</span>
        ))}
      </div>

      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28, paddingTop: 12, flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: "clamp(28px, 7vw, 40px)", fontWeight: 900, color: "#fff", letterSpacing: "-1.5px", textShadow: "0 0 20px rgba(250, 204, 21, 0.4), 0 0 40px rgba(250, 204, 21, 0.15)" }}>Backchannel</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            onClick={() => { setProfileName(user.displayName || ""); setProfilePhoto(user.photoURL || ""); setShowProfile(true); }}
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 8px", borderRadius: 6, transition: "background 0.2s" }}
            onMouseOver={(e) => { e.currentTarget.style.background = "var(--surface-hover)"; }}
            onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            {user.photoURL ? (
              <img src={user.photoURL} alt="" style={{ width: 36, height: 36, borderRadius: "50%", border: "2px solid var(--border)" }} />
            ) : (
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff" }}>
                {(user.displayName || "?")[0].toUpperCase()}
              </div>
            )}
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{user.displayName}</span>
          </div>
          <button className="btn-outline" onClick={logout} style={{ padding: "6px 14px", fontSize: 12 }}>
            Sign out
          </button>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 20, marginBottom: 28 }}>
        {/* Create Room */}
        <div className="card">
          <h2 style={{ fontSize: 15, marginBottom: 14, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.02em" }}>Create a Room</h2>
          <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              placeholder="Room name..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            {/* Vibe Picker */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Object.entries(VIBES).map(([key, v]) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => setVibe(key)}
                  style={{
                    padding: "4px 10px",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    background: vibe === key ? v.color : "transparent",
                    color: vibe === key ? "#fff" : v.color,
                    border: `1px solid ${v.color}`,
                    borderRadius: 12,
                    opacity: vibe === key ? 1 : 0.6,
                    transition: "all 0.2s",
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <button className="btn-primary" type="submit">Create</button>
          </form>
        </div>

        {/* Join Room */}
        <div className="card">
          <h2 style={{ fontSize: 15, marginBottom: 14, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.02em" }}>Join a Room</h2>
          <form onSubmit={handleJoin} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              placeholder="Room ID"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
            />
            <button className="btn-primary" type="submit">Join</button>
          </form>
        </div>
      </div>

      {/* Room Discovery Feed */}
      <div className="card">
        <h2 style={{ fontSize: 15, marginBottom: 14, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.02em" }}>Discover Rooms</h2>

        {/* Search */}
        <input
          placeholder="Search rooms..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ marginBottom: 12 }}
        />

        {/* Vibe filter tabs */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          {[{ key: "all", label: "ALL", color: "#fff" }, ...Object.entries(VIBES).map(([k, v]) => ({ key: k, label: v.label, color: v.color }))].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setVibeFilter(tab.key)}
              style={{
                padding: "4px 12px", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
                background: vibeFilter === tab.key ? (tab.key === "all" ? "rgba(255,255,255,0.1)" : tab.color) : "transparent",
                color: vibeFilter === tab.key ? "#fff" : (tab.key === "all" ? "var(--text-muted)" : tab.color),
                border: `1px solid ${tab.key === "all" ? "var(--border)" : tab.color}`,
                borderRadius: 12,
                opacity: vibeFilter === tab.key ? 1 : 0.6,
                transition: "all 0.2s",
              }}
            >{tab.label}</button>
          ))}
        </div>

        {/* Room list */}
        {discoveryRooms.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
            {discoveryLoading ? "Loading..." : "No rooms found."}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {discoveryRooms.map((room) => {
              const rv = VIBES[room.vibe] || VIBES.chill;
              return (
                <div
                  key={room.id}
                  onClick={() => router.push(`/room/${room.id}`)}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "16px 20px", background: "rgba(22, 27, 36, 0.5)", borderRadius: 10,
                    cursor: "pointer", border: "1px solid transparent", transition: "all 0.2s",
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.borderColor = rv.color + "40"; e.currentTarget.style.background = "rgba(22, 27, 36, 0.8)"; }}
                  onMouseOut={(e) => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.background = "rgba(22, 27, 36, 0.5)"; }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    {room.is_live && <span className="live-badge">LIVE</span>}
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                      background: rv.color + "20", color: rv.color, letterSpacing: "0.05em", flexShrink: 0,
                      animation: room.vibe === "breaking" ? "breakingPulse 2s infinite" : "none",
                    }}>{rv.label}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{room.title}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {room.creator_name || "Unknown"}
                        {room.is_live ? (
                          <span style={{ marginLeft: 6 }}>
                            <span style={{ color: "var(--success)" }}>{room.live_speakers} speaking</span>
                            {room.live_listeners > 0 && (
                              <span>, {room.live_listeners} listening</span>
                            )}
                          </span>
                        ) : (
                          <span> · {room.participant_count} joined</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span className="hide-mobile" style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{room.id}</span>
                    {room.created_by === user.uid && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(room.id); setDiscoveryRooms((prev) => prev.filter((r) => r.id !== room.id)); }}
                        style={{ background: "transparent", border: "none", color: "var(--danger)", padding: "4px 8px", fontSize: 12, opacity: 0.6 }}
                        onMouseOver={(e) => { e.currentTarget.style.opacity = "1"; }}
                        onMouseOut={(e) => { e.currentTarget.style.opacity = "0.6"; }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Live counter on dashboard */}
      {activeUsers > 0 && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            <span style={{ color: "var(--success)", fontWeight: 600 }}>{activeUsers}</span> people talking right now
          </span>
        </div>
      )}

      {/* Profile Edit Modal */}
      {showProfile && (
        <div
          onClick={() => setShowProfile(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ width: "min(360px, calc(100vw - 48px))", padding: 24 }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 20 }}>Edit Profile</h2>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginBottom: 20 }}>
              {profilePhoto ? (
                <img src={profilePhoto} alt="" style={{ width: 84, height: 84, borderRadius: "50%", border: "2px solid var(--primary)" }} />
              ) : (
                <div style={{ width: 84, height: 84, borderRadius: "50%", background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, fontWeight: 700, color: "#fff" }}>
                  {(profileName || "?")[0].toUpperCase()}
                </div>
              )}
              <label style={{ cursor: "pointer", fontSize: 12, color: "var(--primary)", fontWeight: 600 }}>
                {uploading ? "Uploading..." : "Change Photo"}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  disabled={uploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploading(true);
                    try {
                      const base64 = await resizeImage(file, 96);
                      await changeAvatar(base64);
                      setProfilePhoto(base64);
                    } catch (err) {
                      console.error("Upload failed:", err);
                    }
                    setUploading(false);
                  }}
                />
              </label>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Display Name</label>
                <input
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button
                className="btn-primary"
                style={{ flex: 1 }}
                onClick={async () => {
                  await editProfile({ displayName: profileName.trim() || user.displayName });
                  setShowProfile(false);
                }}
              >
                Save
              </button>
              <button className="btn-outline" onClick={() => setShowProfile(false)} style={{ flex: 1 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
