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

const { handleFactCheck } = require("./services/factcheck");
const { extractUrls, getUrlPreview } = require("./services/urlPreview");
const {
  enableDebateMode, disableDebateMode, getDebateSession, getRoomMode, getRawSession,
  setTopic, registerDebater, unregisterDebater, openPredictions, addPrediction,
  startDebate, advanceRound, submitScore, endDebate, markEnded,
  calculateWinner, getScoreboard, addFactCheck, destroySession,
} = require("./services/debate");
const { generateJudgeSummary } = require("./services/aiJudge");

// Track which users are in which rooms: { roomId: [{ socketId, userId, displayName }] }
const rooms = {};

// Track banned users per room: { roomId: Set<userId> }
const bannedUsers = {};

// Track room creators: { roomId: userId }
const roomCreators = {};

// Track debate round timers: { roomId: timeoutId }
const debateTimers = {};

function setupSocket(io) {
  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    /**
     * "join-room" — A user wants to join a voice room.
     * We add them to the room's participant list and notify all
     * existing participants so they can initiate peer connections.
     */
    socket.on("join-room", ({ roomId, userId, displayName, photoURL, createdBy }) => {
      // Check if user is banned from this room
      if (bannedUsers[roomId] && bannedUsers[roomId].has(userId)) {
        socket.emit("join-denied", { reason: "banned" });
        return;
      }

      socket.join(roomId);

      // Initialize room array if first user
      if (!rooms[roomId]) rooms[roomId] = [];

      // Track room creator (first one to pass createdBy, or first joiner)
      if (createdBy && !roomCreators[roomId]) {
        roomCreators[roomId] = createdBy;
      }

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

      // Send current debate state to joining user (if room is in debate mode)
      const debateSession = getDebateSession(roomId);
      if (debateSession) {
        socket.emit("room-mode-change", { mode: "debate", session: debateSession });
      }

      console.log(`${displayName} joined room ${roomId} (${rooms[roomId].length} users)`);
    });

    /**
     * "kick-user" — Room creator kicks a user from the room.
     */
    socket.on("kick-user", ({ roomId, targetUserId }) => {
      // Verify sender is the room creator
      if (roomCreators[roomId] !== socket.userId) return;

      // Add to banned list
      if (!bannedUsers[roomId]) bannedUsers[roomId] = new Set();
      bannedUsers[roomId].add(targetUserId);

      // Find target socket(s) in the room
      const roomUsers = rooms[roomId] || [];
      const targetUser = roomUsers.find((u) => u.userId === targetUserId);
      if (!targetUser) return;

      // Emit kicked event to the target
      io.to(targetUser.socketId).emit("kicked");

      // Remove target from room
      rooms[roomId] = roomUsers.filter((u) => u.userId !== targetUserId);

      // Notify remaining users
      socket.to(roomId).emit("user-disconnected", {
        socketId: targetUser.socketId,
        userId: targetUser.userId,
        displayName: targetUser.displayName,
      });

      // Force the target socket to leave the room
      const targetSocket = io.sockets.sockets.get(targetUser.socketId);
      if (targetSocket) {
        targetSocket.leave(roomId);
        targetSocket.roomId = null;
      }

      console.log(`${targetUser.displayName} was kicked from room ${roomId} by creator`);
    });

    /**
     * "reaction" — Send emoji reaction to a participant.
     */
    socket.on("reaction", ({ roomId, targetUserId, type }) => {
      const validReactions = ["fire", "cook", "laugh", "thumbsup", "mad", "thumbsdown"];
      if (!validReactions.includes(type)) return;
      io.to(roomId).emit("reaction", {
        fromUser: socket.userId,
        targetUserId,
        type,
        timestamp: Date.now(),
      });
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
     * "chat-message" — Relay text chat to everyone in the room.
     * Ephemeral — not persisted to DB.
     * Also handles /fact command for AI fact-checking.
     */
    socket.on("chat-message", async ({ roomId, text }) => {
      if (!text || !text.trim()) return;
      const trimmed = text.trim();
      const timestamp = Date.now();

      // Broadcast the original message to others
      socket.to(roomId).emit("chat-message", {
        sender: socket.displayName,
        photoURL: socket.photoURL,
        text: trimmed,
        timestamp,
      });

      // Handle /fact command
      if (trimmed.startsWith("/fact ")) {
        const query = trimmed.slice(6).trim();
        const result = await handleFactCheck(socket.userId, roomId, query);
        // Track fact checks during active debates
        if (result.type === "fact") addFactCheck(roomId, result);
        // Emit AI response to entire room (including sender)
        io.to(roomId).emit("ai-response", result);
      }

      // URL preview — fetch asynchronously after broadcast so chat isn't delayed
      const urls = extractUrls(trimmed);
      if (urls.length > 0) {
        getUrlPreview(urls[0]).then((preview) => {
          if (preview) {
            io.to(roomId).emit("url-preview", { text: trimmed, timestamp, preview });
          }
        }).catch(() => {});
      }
    });

    /**
     * "disconnect" — Clean up when a user leaves.
     * Remove them from the room and notify remaining participants
     * so they can tear down the corresponding peer connection.
     */
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
          // Also clean up debate state
          destroySession(roomId);
          if (debateTimers[roomId]) {
            clearTimeout(debateTimers[roomId]);
            delete debateTimers[roomId];
          }
        }
      }
    });

    // ─── Debate Mode Events ─────────────────────────────────────

    socket.on("enable-debate-mode", ({ roomId, config }) => {
      if (roomCreators[roomId] !== socket.userId) {
        socket.emit("debate-error", { message: "Only the room creator can enable debate mode." });
        return;
      }
      const result = enableDebateMode(roomId, socket.userId, config || {});
      if (result.error) {
        socket.emit("debate-error", { message: result.error });
        return;
      }
      io.to(roomId).emit("room-mode-change", { mode: "debate", session: result.session });
    });

    socket.on("disable-debate-mode", ({ roomId }) => {
      if (roomCreators[roomId] !== socket.userId) {
        socket.emit("debate-error", { message: "Only the room creator can disable debate mode." });
        return;
      }
      const result = disableDebateMode(roomId, socket.userId);
      if (result.error) {
        socket.emit("debate-error", { message: result.error });
        return;
      }
      if (debateTimers[roomId]) {
        clearTimeout(debateTimers[roomId]);
        delete debateTimers[roomId];
      }
      io.to(roomId).emit("room-mode-change", { mode: "casual" });
    });

    socket.on("debate-set-topic", ({ roomId, topic, sides }) => {
      if (roomCreators[roomId] !== socket.userId) {
        socket.emit("debate-error", { message: "Only the host can set the topic." });
        return;
      }
      const result = setTopic(roomId, socket.userId, topic, sides);
      if (result.error) { socket.emit("debate-error", { message: result.error }); return; }
      io.to(roomId).emit("debate-update", getDebateSession(roomId));
    });

    socket.on("debate-register", ({ roomId, side }) => {
      const result = registerDebater(roomId, socket.userId, side, socket.displayName, socket.photoURL);
      if (result.error) { socket.emit("debate-error", { message: result.error }); return; }
      io.to(roomId).emit("debate-update", getDebateSession(roomId));
    });

    socket.on("debate-unregister", ({ roomId }) => {
      const result = unregisterDebater(roomId, socket.userId);
      if (result.error) { socket.emit("debate-error", { message: result.error }); return; }
      io.to(roomId).emit("debate-update", getDebateSession(roomId));
    });

    socket.on("debate-open-predictions", ({ roomId }) => {
      if (roomCreators[roomId] !== socket.userId) {
        socket.emit("debate-error", { message: "Only the host can open predictions." });
        return;
      }
      const result = openPredictions(roomId, socket.userId);
      if (result.error) { socket.emit("debate-error", { message: result.error }); return; }
      io.to(roomId).emit("debate-update", getDebateSession(roomId));
    });

    socket.on("debate-predict", ({ roomId, predictedSide }) => {
      const result = addPrediction(roomId, socket.userId, predictedSide);
      if (result.error) { socket.emit("debate-error", { message: result.error }); return; }
      io.to(roomId).emit("debate-update", getDebateSession(roomId));
    });

    socket.on("debate-start", ({ roomId }) => {
      if (roomCreators[roomId] !== socket.userId) {
        socket.emit("debate-error", { message: "Only the host can start the debate." });
        return;
      }
      const result = startDebate(roomId, socket.userId);
      if (result.error) { socket.emit("debate-error", { message: result.error }); return; }
      io.to(roomId).emit("debate-update", getDebateSession(roomId));
      scheduleRoundEnd(io, roomId);
    });

    socket.on("debate-score", ({ roomId, targetUserId, score }) => {
      const result = submitScore(roomId, socket.userId, targetUserId, score);
      if (result.error) { socket.emit("debate-error", { message: result.error }); return; }
      io.to(roomId).emit("debate-scoreboard", getScoreboard(roomId));
    });

    // ─── Video / Screen Share Relay Events ───────────────────
    socket.on("user-video-toggle", ({ roomId, videoEnabled }) => {
      socket.to(roomId).emit("user-video-toggle", {
        userId: socket.userId,
        socketId: socket.id,
        videoEnabled,
      });
    });

    socket.on("user-screen-share", ({ roomId, screenSharing, displayName }) => {
      socket.to(roomId).emit("user-screen-share", {
        userId: socket.userId,
        socketId: socket.id,
        screenSharing,
        displayName: displayName || socket.displayName,
      });
    });

    socket.on("debate-end", async ({ roomId }) => {
      if (roomCreators[roomId] !== socket.userId) {
        socket.emit("debate-error", { message: "Only the host can end the debate." });
        return;
      }
      await finalizeDebate(io, roomId);
    });
  });

  // ─── Debate Timer Helpers ───────────────────────────────────

  function scheduleRoundEnd(io, roomId) {
    const session = getDebateSession(roomId);
    if (!session || session.status !== "active") return;
    if (debateTimers[roomId]) clearTimeout(debateTimers[roomId]);

    const msLeft = session.rounds.timerEnd - Date.now();
    debateTimers[roomId] = setTimeout(async () => {
      const s = getDebateSession(roomId);
      if (!s || s.status !== "active") return;

      const advResult = advanceRound(roomId, roomCreators[roomId]);
      if (advResult.done) {
        // Final round ended — trigger judging
        await finalizeDebate(io, roomId);
      } else if (advResult.ok) {
        io.to(roomId).emit("debate-update", getDebateSession(roomId));
        scheduleRoundEnd(io, roomId);
      }
    }, Math.max(msLeft, 0));
  }

  async function finalizeDebate(io, roomId) {
    if (debateTimers[roomId]) {
      clearTimeout(debateTimers[roomId]);
      delete debateTimers[roomId];
    }

    const endResult = endDebate(roomId, roomCreators[roomId]);
    if (endResult.error) return;

    // Broadcast judging status
    io.to(roomId).emit("debate-update", getDebateSession(roomId));

    // Calculate score-based winner
    const scoreResult = calculateWinner(roomId);

    // Try AI judge
    const rawSession = getRawSession(roomId);
    let aiResult = null;
    if (rawSession) {
      try {
        aiResult = await generateJudgeSummary(rawSession);
      } catch (e) {
        console.error("AI judge failed:", e.message);
      }
    }

    // Determine final winner
    const winnerSide = (aiResult?.winner && aiResult.winner !== "tie")
      ? aiResult.winner
      : scoreResult.winnerSide;

    let winnerId = null;
    let winnerDisplayName = null;
    let winnerPhotoURL = null;

    if (winnerSide && winnerSide !== "tie" && rawSession) {
      const entry = Object.entries(rawSession.debaters)
        .find(([, d]) => d.side === winnerSide);
      if (entry) {
        winnerId = entry[0];
        winnerDisplayName = entry[1].displayName;
        winnerPhotoURL = entry[1].photoURL;
      }
    }

    const winnerPayload = {
      winnerId,
      winnerDisplayName: winnerDisplayName || (winnerSide === "tie" ? "Tie" : winnerSide),
      winnerPhotoURL,
      winnerSide,
      method: aiResult?.winner ? "ai-judge" : "score",
      summary: aiResult?.summary || scoreResult.summary || "Winner decided by audience scores.",
      scores: scoreResult.scores || {},
      predictions: rawSession?.predictions?.counts || {},
    };

    markEnded(roomId);
    io.to(roomId).emit("debate-winner", winnerPayload);
    io.to(roomId).emit("debate-update", getDebateSession(roomId));
  }
}

function getActiveUserCount() {
  let count = 0;
  for (const roomId in rooms) {
    count += rooms[roomId].length;
  }
  return count;
}

module.exports = { setupSocket, getActiveUserCount };
