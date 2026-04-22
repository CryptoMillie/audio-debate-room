/**
 * Debate Session State Machine
 *
 * Manages ephemeral in-memory debate state per room.
 * Status flow: setup → predictions → active → judging → ended
 *
 * All state lives in memory (like rooms/bannedUsers in socket.js).
 * When the room empties, the session is destroyed.
 */

// { roomId: DebateSession }
const debateSessions = {};

// ─── Session Factory ──────────────────────────────────────────

function createSession(roomId, userId, config = {}) {
  return {
    roomId,
    status: "setup",
    createdBy: userId,
    topic: null,
    sides: config.sides || ["For", "Against"],
    debaters: {},
    predictions: {
      voters: {},
      counts: {},
    },
    rounds: {
      total: config.rounds || 3,
      current: 0,
      durationSec: config.durationSec || 120,
      timerEnd: null,
      history: [],
    },
    scores: {},
    factChecks: [],
    winner: null,
    startedAt: null,
    endedAt: null,
  };
}

// ─── Mode Management ──────────────────────────────────────────

function enableDebateMode(roomId, userId, config = {}) {
  const existing = debateSessions[roomId];
  if (existing && existing.status !== "ended") {
    return { error: "A debate session is already active in this room." };
  }
  const session = createSession(roomId, userId, config);
  // Initialize prediction counts for each side
  session.sides.forEach((s) => { session.predictions.counts[s] = 0; });
  debateSessions[roomId] = session;
  return { session: sanitizeSession(session) };
}

function disableDebateMode(roomId, userId) {
  const session = debateSessions[roomId];
  if (!session) return { ok: true };
  if (session.createdBy !== userId) {
    return { error: "Only the debate creator can disable debate mode." };
  }
  if (session.status === "active" || session.status === "judging") {
    return { error: "Cannot disable debate mode while a debate is in progress." };
  }
  delete debateSessions[roomId];
  return { ok: true };
}

function getDebateSession(roomId) {
  const session = debateSessions[roomId];
  return session ? sanitizeSession(session) : null;
}

function getRoomMode(roomId) {
  return debateSessions[roomId] ? "debate" : "casual";
}

// ─── Setup Phase ──────────────────────────────────────────────

function setTopic(roomId, userId, topic, sides) {
  const session = debateSessions[roomId];
  if (!session) return { error: "No debate session." };
  if (session.createdBy !== userId) return { error: "Only the host can set the topic." };
  if (session.status !== "setup") return { error: "Topic can only be set during setup." };

  session.topic = (topic || "").trim().slice(0, 200);
  if (sides && Array.isArray(sides) && sides.length === 2) {
    session.sides = sides.map((s) => String(s).trim().slice(0, 40));
    // Reset prediction counts for new sides
    session.predictions.counts = {};
    session.predictions.voters = {};
    session.sides.forEach((s) => { session.predictions.counts[s] = 0; });
  }
  return { ok: true };
}

function registerDebater(roomId, userId, side, displayName, photoURL) {
  const session = debateSessions[roomId];
  if (!session) return { error: "No debate session." };
  if (session.status !== "setup" && session.status !== "predictions") {
    return { error: "Registration is closed." };
  }
  if (!session.sides.includes(side)) {
    return { error: `Invalid side. Choose: ${session.sides.join(" or ")}` };
  }

  // Limit to 1 debater per side (1v1 format)
  const sideCount = Object.values(session.debaters).filter((d) => d.side === side).length;
  const existingEntry = session.debaters[userId];
  if (sideCount >= 1 && (!existingEntry || existingEntry.side !== side)) {
    return { error: `Side "${side}" is already taken.` };
  }

  session.debaters[userId] = { side, displayName, photoURL };
  if (!session.scores[userId]) session.scores[userId] = 0;
  return { ok: true };
}

function unregisterDebater(roomId, userId) {
  const session = debateSessions[roomId];
  if (!session) return { error: "No debate session." };
  if (session.status !== "setup") return { error: "Can only unregister during setup." };
  delete session.debaters[userId];
  delete session.scores[userId];
  return { ok: true };
}

// ─── Predictions Phase ────────────────────────────────────────

function openPredictions(roomId, userId) {
  const session = debateSessions[roomId];
  if (!session) return { error: "No debate session." };
  if (session.createdBy !== userId) return { error: "Only the host can open predictions." };
  if (session.status !== "setup") return { error: "Predictions can only be opened from setup." };

  const debaterCount = Object.keys(session.debaters).length;
  if (debaterCount < 2) return { error: "Need at least 2 debaters before opening predictions." };

  // Check both sides have a debater
  const sidesRepresented = new Set(Object.values(session.debaters).map((d) => d.side));
  if (sidesRepresented.size < 2) return { error: "Both sides need a debater." };

  session.status = "predictions";
  return { ok: true };
}

function addPrediction(roomId, voterId, predictedSide) {
  const session = debateSessions[roomId];
  if (!session) return { error: "No debate session." };
  if (session.status !== "predictions") return { error: "Predictions are not open." };
  if (!session.sides.includes(predictedSide)) return { error: "Invalid side." };

  // Debaters cannot predict
  if (session.debaters[voterId]) return { error: "Debaters cannot vote on predictions." };

  // Remove previous vote if re-voting
  const previousVote = session.predictions.voters[voterId];
  if (previousVote) {
    session.predictions.counts[previousVote] = Math.max(0, (session.predictions.counts[previousVote] || 0) - 1);
  }

  session.predictions.voters[voterId] = predictedSide;
  session.predictions.counts[predictedSide] = (session.predictions.counts[predictedSide] || 0) + 1;
  return { ok: true };
}

// ─── Active Debate ────────────────────────────────────────────

function startDebate(roomId, userId) {
  const session = debateSessions[roomId];
  if (!session) return { error: "No debate session." };
  if (session.createdBy !== userId) return { error: "Only the host can start the debate." };
  if (session.status !== "setup" && session.status !== "predictions") {
    return { error: "Debate can only be started from setup or predictions phase." };
  }

  const debaterCount = Object.keys(session.debaters).length;
  if (debaterCount < 2) return { error: "Need at least 2 debaters to start." };

  const sidesRepresented = new Set(Object.values(session.debaters).map((d) => d.side));
  if (sidesRepresented.size < 2) return { error: "Both sides need a debater." };

  if (!session.topic) return { error: "Set a topic before starting." };

  session.status = "active";
  session.startedAt = Date.now();
  session.rounds.current = 1;
  session.rounds.timerEnd = Date.now() + session.rounds.durationSec * 1000;
  return { ok: true };
}

function advanceRound(roomId, userId) {
  const session = debateSessions[roomId];
  if (!session) return { error: "No debate session." };
  if (session.createdBy !== userId) return { error: "Only the host can advance rounds." };
  if (session.status !== "active") return { error: "Debate is not active." };

  // Save current round scores snapshot
  session.rounds.history.push({
    round: session.rounds.current,
    scores: { ...session.scores },
    endedAt: Date.now(),
  });

  if (session.rounds.current >= session.rounds.total) {
    // Final round done — signal to trigger judging
    return { done: true };
  }

  session.rounds.current += 1;
  session.rounds.timerEnd = Date.now() + session.rounds.durationSec * 1000;
  return { ok: true };
}

function submitScore(roomId, scorerUserId, targetUserId, score) {
  const session = debateSessions[roomId];
  if (!session) return { error: "No debate session." };
  if (session.status !== "active") return { error: "Scoring only during active debate." };

  // Debaters cannot score themselves
  if (session.debaters[scorerUserId]) return { error: "Debaters cannot score." };

  // Target must be a debater
  if (!session.debaters[targetUserId]) return { error: "Can only score debaters." };

  // Score is +1 per vote (simple)
  const points = score === -1 ? -1 : 1;
  session.scores[targetUserId] = (session.scores[targetUserId] || 0) + points;
  return { ok: true, scores: { ...session.scores } };
}

function endDebate(roomId, userId) {
  const session = debateSessions[roomId];
  if (!session) return { error: "No debate session." };
  if (session.createdBy !== userId) return { error: "Only the host can end the debate." };
  if (session.status !== "active" && session.status !== "judging") {
    return { error: "No active debate to end." };
  }

  // Save final round if not already saved
  if (session.status === "active") {
    session.rounds.history.push({
      round: session.rounds.current,
      scores: { ...session.scores },
      endedAt: Date.now(),
    });
  }

  session.status = "judging";
  session.rounds.timerEnd = null;
  session.endedAt = Date.now();
  return { ok: true };
}

function markEnded(roomId) {
  const session = debateSessions[roomId];
  if (session) session.status = "ended";
}

// ─── Scoring & Winner ─────────────────────────────────────────

function calculateWinner(roomId) {
  const session = debateSessions[roomId];
  if (!session) return { error: "No debate session." };

  const debaterEntries = Object.entries(session.debaters);
  if (debaterEntries.length < 2) return { winnerSide: null, summary: "Not enough debaters." };

  // Find highest score
  let highScore = -Infinity;
  let winnerId = null;
  for (const [uid] of debaterEntries) {
    const s = session.scores[uid] || 0;
    if (s > highScore) {
      highScore = s;
      winnerId = uid;
    }
  }

  // Check for tie
  const tiedDebaters = debaterEntries.filter(([uid]) => (session.scores[uid] || 0) === highScore);
  if (tiedDebaters.length > 1) {
    return {
      winnerSide: "tie",
      winnerId: null,
      summary: `It's a tie! Both debaters scored ${highScore} points.`,
      scores: { ...session.scores },
    };
  }

  const winner = session.debaters[winnerId];
  return {
    winnerSide: winner.side,
    winnerId,
    winnerDisplayName: winner.displayName,
    winnerPhotoURL: winner.photoURL,
    summary: `${winner.displayName} wins with ${highScore} points for the "${winner.side}" side.`,
    scores: { ...session.scores },
  };
}

function getScoreboard(roomId) {
  const session = debateSessions[roomId];
  if (!session) return null;
  return {
    scores: { ...session.scores },
    debaters: { ...session.debaters },
    round: session.rounds.current,
    totalRounds: session.rounds.total,
  };
}

// ─── Fact Check Tracking ──────────────────────────────────────

function addFactCheck(roomId, factCheckResult) {
  const session = debateSessions[roomId];
  if (session && session.status === "active") {
    session.factChecks.push({
      query: factCheckResult.originalQuery,
      result: factCheckResult.text,
      timestamp: Date.now(),
    });
  }
}

// ─── Cleanup ──────────────────────────────────────────────────

function destroySession(roomId) {
  delete debateSessions[roomId];
}

// ─── Internal Session (raw, for AI judge) ─────────────────────

function getRawSession(roomId) {
  return debateSessions[roomId] || null;
}

// ─── Sanitize for Client ──────────────────────────────────────

function sanitizeSession(session) {
  return {
    roomId: session.roomId,
    status: session.status,
    createdBy: session.createdBy,
    topic: session.topic,
    sides: session.sides,
    debaters: session.debaters,
    predictions: {
      counts: session.predictions.counts,
      totalVoters: Object.keys(session.predictions.voters).length,
      // Don't expose who voted for what
    },
    rounds: {
      total: session.rounds.total,
      current: session.rounds.current,
      durationSec: session.rounds.durationSec,
      timerEnd: session.rounds.timerEnd,
    },
    scores: session.scores,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
  };
}

module.exports = {
  enableDebateMode,
  disableDebateMode,
  getDebateSession,
  getRoomMode,
  getRawSession,
  setTopic,
  registerDebater,
  unregisterDebater,
  openPredictions,
  addPrediction,
  startDebate,
  advanceRound,
  submitScore,
  endDebate,
  markEnded,
  calculateWinner,
  getScoreboard,
  addFactCheck,
  destroySession,
};
