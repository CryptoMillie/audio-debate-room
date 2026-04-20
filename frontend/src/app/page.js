"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { createRoom, listRooms, deleteRoom } from "@/lib/api";

export default function Dashboard() {
  const { user, loading, login, logout } = useAuth();
  const [title, setTitle] = useState("");
  const [joinId, setJoinId] = useState("");
  const [rooms, setRooms] = useState([]);
  const router = useRouter();

  useEffect(() => {
    if (user) {
      listRooms().then(setRooms).catch(console.error);
    }
  }, [user]);

  if (loading) {
    return (
      <div className="container" style={{ textAlign: "center", marginTop: 160 }}>
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container" style={{ textAlign: "center", marginTop: 160 }}>
        <h1 style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-1px", marginBottom: 8, color: "#fff" }}>
          Backchannel
        </h1>
        <p style={{ color: "var(--text-muted)", marginBottom: 40, fontSize: 15 }}>
          Real-time audio rooms for private conversations
        </p>
        <button className="btn-primary" onClick={login} style={{ fontSize: 15, padding: "14px 40px", borderRadius: 8 }}>
          Sign in with Google
        </button>
      </div>
    );
  }

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    const { roomId } = await createRoom(title.trim(), user.uid);
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
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 40, paddingTop: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px" }}>Backchannel</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {user.photoURL && (
            <img src={user.photoURL} alt="" style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid var(--border)" }} />
          )}
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{user.displayName}</span>
          <button className="btn-outline" onClick={logout} style={{ padding: "6px 14px", fontSize: 12 }}>
            Sign out
          </button>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Create Room */}
        <div className="card">
          <h2 style={{ fontSize: 14, marginBottom: 12, color: "var(--text-muted)", fontWeight: 500 }}>Create a Room</h2>
          <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              placeholder="Room name..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button className="btn-primary" type="submit">Create</button>
          </form>
        </div>

        {/* Join Room */}
        <div className="card">
          <h2 style={{ fontSize: 14, marginBottom: 12, color: "var(--text-muted)", fontWeight: 500 }}>Join a Room</h2>
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

      {/* Room List */}
      <div className="card">
        <h2 style={{ fontSize: 14, marginBottom: 16, color: "var(--text-muted)", fontWeight: 500 }}>Active Rooms</h2>
        {rooms.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
            No rooms yet. Create one to get started.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rooms.map((room) => (
              <div
                key={room.id}
                onClick={() => router.push(`/room/${room.id}`)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 16px",
                  background: "rgba(22, 27, 36, 0.5)",
                  borderRadius: 8,
                  cursor: "pointer",
                  border: "1px solid transparent",
                  transition: "all 0.2s",
                }}
                onMouseOver={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "rgba(22, 27, 36, 0.8)"; }}
                onMouseOut={(e) => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.background = "rgba(22, 27, 36, 0.5)"; }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{room.title}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {room.creator_name || "Unknown"} · {room.participant_count} joined
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{room.id}</span>
                  {room.created_by === user.uid && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(room.id); }}
                      style={{ background: "transparent", border: "none", color: "var(--danger)", padding: "4px 8px", fontSize: 12, opacity: 0.6 }}
                      onMouseOver={(e) => { e.currentTarget.style.opacity = "1"; }}
                      onMouseOut={(e) => { e.currentTarget.style.opacity = "0.6"; }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
