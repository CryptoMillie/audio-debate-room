const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export function syncUser(user) {
  return request("/auth/user", {
    method: "POST",
    body: JSON.stringify({
      id: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
    }),
  });
}

export function createRoom(title, userId, vibe) {
  return request("/create-room", {
    method: "POST",
    body: JSON.stringify({ title, userId, vibe }),
  });
}

export function getStats() {
  return request("/stats");
}

export function getRoom(roomId) {
  return request(`/rooms/${roomId}`);
}

export function joinRoom(roomId, userId) {
  return request("/join-room", {
    method: "POST",
    body: JSON.stringify({ roomId, userId }),
  });
}

export function listRooms() {
  return request("/rooms");
}

export function deleteRoom(roomId, userId) {
  return request(`/rooms/${roomId}?userId=${userId}`, { method: "DELETE" });
}

export function updateAvatar(userId, avatar) {
  return request(`/users/${userId}/avatar`, {
    method: "PUT",
    body: JSON.stringify({ avatar }),
  });
}

export function getAvatar(userId) {
  return request(`/users/${userId}/avatar`);
}
