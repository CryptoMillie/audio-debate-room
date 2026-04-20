/**
 * Socket.IO signaling server for WebRTC
 *
 * WebRTC Signaling Flow:
 * ──────────────────────
 * WebRTC allows browsers to establish direct peer-to-peer connections for
 * streaming audio/video. However, before a direct connection can be made,
 * the peers need to exchange connection metadata (called "signaling").
 *
 * This server acts as the signaling relay:
 *
 * 1. User A joins a room → server tells everyone "user-connected"
 * 2. User B (already in room) creates an SDP "offer" via simple-peer
 *    and sends it to User A through this server ("signal" event)
 * 3. User A receives the offer, creates an SDP "answer", sends it back
 *    through this server ("signal" event)
 * 4. Both peers also exchange ICE candidates (network path info) via
 *    "signal" events
 * 5. Once signaling completes, the browsers establish a direct P2P
 *    audio stream — the server is no longer in the data path
 *
 * The server only relays signaling messages; actual audio flows
 * directly between browsers via WebRTC.
 */

// Track which users are in which rooms: { roomId: [{ socketId, userId, displayName }] }
const rooms = {};

function setupSocket(io) {
  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    /**
     * "join-room" — A user wants to join a voice room.
     * We add them to the room's participant list and notify all
     * existing participants so they can initiate peer connections.
     */
    socket.on("join-room", ({ roomId, userId, displayName, photoURL }) => {
      socket.join(roomId);

      // Initialize room array if first user
      if (!rooms[roomId]) rooms[roomId] = [];

      const user = { socketId: socket.id, userId, displayName, photoURL };
      rooms[roomId].push(user);

      // Store room info on socket for cleanup on disconnect
      socket.roomId = roomId;
      socket.userId = userId;
      socket.displayName = displayName;
      socket.photoURL = photoURL;

      // Tell the joining user about everyone already in the room
      // so they can create peer connections to each existing user
      const existingUsers = rooms[roomId].filter((u) => u.socketId !== socket.id);
      socket.emit("existing-users", existingUsers);

      // Tell everyone else in the room that a new user connected
      socket.to(roomId).emit("user-connected", user);

      console.log(`${displayName} joined room ${roomId} (${rooms[roomId].length} users)`);
    });

    /**
     * "signal" — Relay WebRTC signaling data between two peers.
     * This carries SDP offers/answers and ICE candidates.
     * The server does NOT inspect or modify this data — it just
     * forwards it to the target peer identified by targetSocketId.
     */
    socket.on("signal", ({ targetSocketId, signal }) => {
      io.to(targetSocketId).emit("signal", {
        fromSocketId: socket.id,
        signal,
      });
    });

    /**
     * "disconnect" — Clean up when a user leaves.
     * Remove them from the room and notify remaining participants
     * so they can tear down the corresponding peer connection.
     */
    /**
     * "chat-message" — Relay text chat to everyone in the room.
     * Ephemeral — not persisted to DB.
     */
    socket.on("chat-message", ({ roomId, text }) => {
      if (!text || !text.trim()) return;
      socket.to(roomId).emit("chat-message", {
        sender: socket.displayName,
        photoURL: socket.photoURL,
        text: text.trim(),
        timestamp: Date.now(),
      });
    });

    socket.on("disconnect", () => {
      const { roomId, userId, displayName } = socket;
      if (roomId && rooms[roomId]) {
        rooms[roomId] = rooms[roomId].filter((u) => u.socketId !== socket.id);

        // Notify remaining users
        socket.to(roomId).emit("user-disconnected", {
          socketId: socket.id,
          userId,
          displayName,
        });

        console.log(`${displayName} left room ${roomId} (${rooms[roomId].length} users)`);

        // Clean up empty rooms
        if (rooms[roomId].length === 0) {
          delete rooms[roomId];
        }
      }
    });
  });
}

module.exports = { setupSocket };
