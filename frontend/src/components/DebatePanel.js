"use client";

import { useState, useEffect, useRef } from "react";

/**
 * DebatePanel — conditional debate UI rendered when room is in debate mode.
 * Shows different content based on session.status:
 *   setup → topic config, side registration, round settings
 *   predictions → voting on who will win
 *   active → round timer, score buttons
 *   judging → waiting spinner
 *   ended → final scoreboard
 */
export default function DebatePanel({ session, userId, isCreator, socket, roomId, error }) {
  if (!session) return null;

  return (
    <div className="debate-panel">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 14 }}>⚔️</span>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
          color: "var(--danger)",
        }}>
          DEBATE MODE
        </span>
        <span style={{
          fontSize: 10, padding: "2px 8px", borderRadius: 4,
          background: "rgba(224, 49, 49, 0.1)", color: "var(--danger)",
          marginLeft: "auto",
        }}>
          {session.status.toUpperCase()}
        </span>
      </div>

      {error && (
        <div style={{
          fontSize: 12, color: "var(--danger)", marginBottom: 12,
          padding: "8px 12px", borderRadius: 6,
          background: "rgba(224, 49, 49, 0.08)", border: "1px solid rgba(224, 49, 49, 0.15)",
        }}>
          {error}
        </div>
      )}

      {session.status === "setup" && (
        <SetupPhase session={session} userId={userId} isCreator={isCreator} socket={socket} roomId={roomId} />
      )}
      {session.status === "predictions" && (
        <PredictionsPhase session={session} userId={userId} isCreator={isCreator} socket={socket} roomId={roomId} />
      )}
      {session.status === "active" && (
        <ActivePhase session={session} userId={userId} isCreator={isCreator} socket={socket} roomId={roomId} />
      )}
      {session.status === "judging" && (
        <JudgingPhase />
      )}
      {session.status === "ended" && (
        <EndedPhase session={session} />
      )}
    </div>
  );
}

// ─── Setup Phase ──────────────────────────────────────────────

function SetupPhase({ session, userId, isCreator, socket, roomId }) {
  const [topic, setTopic] = useState(session.topic || "");
  const [sideA, setSideA] = useState(session.sides[0] || "For");
  const [sideB, setSideB] = useState(session.sides[1] || "Against");
  const [rounds, setRounds] = useState(session.rounds.total);
  const [duration, setDuration] = useState(session.rounds.durationSec);

  const isDebater = !!session.debaters[userId];
  const mySide = session.debaters[userId]?.side;

  const saveTopic = () => {
    if (!topic.trim()) return;
    socket.emit("debate-set-topic", {
      roomId, topic: topic.trim(), sides: [sideA.trim() || "For", sideB.trim() || "Against"],
    });
  };

  const joinSide = (side) => {
    socket.emit("debate-register", { roomId, side });
  };

  const leaveSide = () => {
    socket.emit("debate-unregister", { roomId });
  };

  const openPreds = () => {
    // Re-save config first
    socket.emit("enable-debate-mode", {
      roomId,
      config: { rounds, durationSec: duration, sides: [sideA.trim() || "For", sideB.trim() || "Against"] },
    });
    setTimeout(() => {
      socket.emit("debate-open-predictions", { roomId });
    }, 100);
  };

  const startNow = () => {
    socket.emit("debate-start", { roomId });
  };

  return (
    <div>
      {/* Topic */}
      {isCreator && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>DEBATE TOPIC</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Is AI good for society?"
              maxLength={200}
              style={{ flex: 1 }}
            />
            <button className="btn-primary" onClick={saveTopic} style={{ padding: "8px 16px", fontSize: 12 }}>Set</button>
          </div>
        </div>
      )}

      {!isCreator && session.topic && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>TOPIC</label>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>{session.topic}</div>
        </div>
      )}

      {/* Side Labels (creator only) */}
      {isCreator && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>SIDE A</label>
            <input value={sideA} onChange={(e) => setSideA(e.target.value)} maxLength={40} style={{ fontSize: 13 }} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>SIDE B</label>
            <input value={sideB} onChange={(e) => setSideB(e.target.value)} maxLength={40} style={{ fontSize: 13 }} />
          </div>
        </div>
      )}

      {/* Round Config (creator only) */}
      {isCreator && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>ROUNDS</label>
            <select
              value={rounds}
              onChange={(e) => setRounds(Number(e.target.value))}
              style={{
                width: "100%", padding: "8px 12px", fontSize: 13,
                background: "rgba(15, 18, 24, 0.8)", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text)",
              }}
            >
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} round{n > 1 ? "s" : ""}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>ROUND TIME</label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              style={{
                width: "100%", padding: "8px 12px", fontSize: 13,
                background: "rgba(15, 18, 24, 0.8)", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text)",
              }}
            >
              {[60, 90, 120, 180, 300].map((s) => (
                <option key={s} value={s}>{s < 120 ? `${s}s` : `${s / 60}min`}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Side Selection (join as debater) */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 8 }}>PICK A SIDE</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {session.sides.map((side) => {
            const debater = Object.entries(session.debaters).find(([, d]) => d.side === side);
            const isMySide = mySide === side;
            const isTaken = debater && !isMySide;
            return (
              <button
                key={side}
                onClick={() => isMySide ? leaveSide() : joinSide(side)}
                disabled={isTaken}
                style={{
                  padding: "12px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: isMySide ? "rgba(59, 91, 219, 0.15)" : "rgba(22, 27, 36, 0.5)",
                  border: isMySide ? "1px solid var(--primary)" : "1px solid var(--border)",
                  color: isTaken ? "var(--text-muted)" : isMySide ? "var(--primary-hover)" : "#fff",
                  opacity: isTaken ? 0.5 : 1,
                  cursor: isTaken ? "not-allowed" : "pointer",
                }}
              >
                <div>{side}</div>
                {debater && (
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                    {debater[1].displayName}{isMySide ? " (You)" : ""}
                  </div>
                )}
                {!debater && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>Open</div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Host Actions */}
      {isCreator && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn-primary" onClick={openPreds} style={{ fontSize: 12, padding: "10px 20px" }}>
            Open Predictions
          </button>
          <button className="btn-outline" onClick={startNow} style={{ fontSize: 12, padding: "10px 20px" }}>
            Skip to Start
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Predictions Phase ────────────────────────────────────────

function PredictionsPhase({ session, userId, isCreator, socket, roomId }) {
  const isDebater = !!session.debaters[userId];
  const totalVotes = session.predictions.totalVoters || 0;

  const predict = (side) => {
    socket.emit("debate-predict", { roomId, predictedSide: side });
  };

  const startDebate = () => {
    socket.emit("debate-start", { roomId });
  };

  return (
    <div>
      {session.topic && (
        <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", marginBottom: 16, textAlign: "center" }}>
          {session.topic}
        </div>
      )}

      {/* Debaters display */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center", marginBottom: 16 }}>
        {session.sides.map((side, i) => {
          const debater = Object.entries(session.debaters).find(([, d]) => d.side === side);
          return (
            <div key={side} style={{ textAlign: "center" }}>
              {debater?.[1]?.photoURL ? (
                <img src={debater[1].photoURL} alt="" style={{ width: 40, height: 40, borderRadius: "50%", margin: "0 auto 4px", display: "block" }} />
              ) : (
                <div style={{
                  width: 40, height: 40, borderRadius: "50%", margin: "0 auto 4px",
                  background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16, fontWeight: 700, color: "#fff",
                }}>
                  {(debater?.[1]?.displayName || "?")[0].toUpperCase()}
                </div>
              )}
              <div style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{debater?.[1]?.displayName || "?"}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{side}</div>
              {i === 0 && <></>}
            </div>
          );
        }).reduce((acc, el, i) => {
          if (i === 1) {
            return [...acc, <div key="vs" style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>VS</div>, el];
          }
          return [...acc, el];
        }, [])}
      </div>

      {/* Prediction voting */}
      {!isDebater && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 8, textAlign: "center" }}>
            WHO WILL WIN? ({totalVotes} vote{totalVotes !== 1 ? "s" : ""})
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {session.sides.map((side) => (
              <button
                key={side}
                onClick={() => predict(side)}
                className="score-btn"
                style={{ padding: "10px", fontSize: 13 }}
              >
                {side}
              </button>
            ))}
          </div>
        </div>
      )}

      {isDebater && (
        <div style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
          Debaters cannot vote on predictions.
        </div>
      )}

      {/* Prediction bar */}
      {totalVotes > 0 && (
        <PredictionBar counts={session.predictions.counts} sides={session.sides} />
      )}

      {/* Start button */}
      {isCreator && (
        <button className="btn-primary" onClick={startDebate} style={{ width: "100%", marginTop: 12, fontSize: 14, padding: "12px" }}>
          Start Debate
        </button>
      )}
    </div>
  );
}

// ─── Active Phase ─────────────────────────────────────────────

function ActivePhase({ session, userId, isCreator, socket, roomId }) {
  const isDebater = !!session.debaters[userId];

  const endDebate = () => {
    socket.emit("debate-end", { roomId });
  };

  return (
    <div>
      {session.topic && (
        <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 12, textAlign: "center" }}>
          {session.topic}
        </div>
      )}

      {/* Round indicator */}
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--primary-hover)", letterSpacing: "0.05em" }}>
          ROUND {session.rounds.current} / {session.rounds.total}
        </span>
      </div>

      {/* Timer */}
      <RoundTimer timerEnd={session.rounds.timerEnd} durationSec={session.rounds.durationSec} />

      {/* Debaters + Scores */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "16px 0" }}>
        {session.sides.map((side) => {
          const debater = Object.entries(session.debaters).find(([, d]) => d.side === side);
          if (!debater) return null;
          const [debaterId, debaterInfo] = debater;
          const score = session.scores[debaterId] || 0;

          return (
            <div key={side} style={{
              textAlign: "center", padding: 12, borderRadius: 8,
              background: "rgba(22, 27, 36, 0.5)", border: "1px solid var(--border)",
            }}>
              {debaterInfo.photoURL ? (
                <img src={debaterInfo.photoURL} alt="" style={{ width: 36, height: 36, borderRadius: "50%", margin: "0 auto 6px", display: "block" }} />
              ) : (
                <div style={{
                  width: 36, height: 36, borderRadius: "50%", margin: "0 auto 6px",
                  background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 700, color: "#fff",
                }}>
                  {(debaterInfo.displayName || "?")[0].toUpperCase()}
                </div>
              )}
              <div style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{debaterInfo.displayName}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>{side}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--primary-hover)" }}>{score}</div>
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>points</div>

              {/* Score buttons for audience */}
              {!isDebater && (
                <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 8 }}>
                  <button
                    onClick={() => socket.emit("debate-score", { roomId, targetUserId: debaterId, score: 1 })}
                    style={{
                      padding: "4px 12px", borderRadius: 6, fontSize: 16,
                      background: "rgba(47, 158, 68, 0.1)", border: "1px solid rgba(47, 158, 68, 0.2)",
                      color: "var(--success)", cursor: "pointer",
                    }}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => socket.emit("debate-score", { roomId, targetUserId: debaterId, score: -1 })}
                    style={{
                      padding: "4px 12px", borderRadius: 6, fontSize: 16,
                      background: "rgba(224, 49, 49, 0.1)", border: "1px solid rgba(224, 49, 49, 0.2)",
                      color: "var(--danger)", cursor: "pointer",
                    }}
                  >
                    👎
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isDebater && (
        <div style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
          You're debating — make your case!
        </div>
      )}

      {isCreator && (
        <button className="btn-danger" onClick={endDebate} style={{ width: "100%", marginTop: 12, fontSize: 12, padding: "10px" }}>
          End Debate Early
        </button>
      )}
    </div>
  );
}

// ─── Judging Phase ────────────────────────────────────────────

function JudgingPhase() {
  return (
    <div style={{ textAlign: "center", padding: "24px 0" }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>🧠</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 8 }}>AI Judge Deliberating...</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Analyzing arguments and scores</div>
      <div style={{ marginTop: 16 }}>
        <div style={{
          width: 32, height: 32, border: "2px solid var(--border)", borderTopColor: "var(--primary)",
          borderRadius: "50%", margin: "0 auto",
          animation: "spin 1s linear infinite",
        }} />
      </div>
    </div>
  );
}

// ─── Ended Phase ──────────────────────────────────────────────

function EndedPhase({ session }) {
  return (
    <div style={{ textAlign: "center", padding: "16px 0" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 12 }}>Debate Ended</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {session.sides.map((side) => {
          const debater = Object.entries(session.debaters).find(([, d]) => d.side === side);
          if (!debater) return null;
          const [debaterId, debaterInfo] = debater;
          const score = session.scores[debaterId] || 0;
          return (
            <div key={side} style={{
              padding: 12, borderRadius: 8,
              background: "rgba(22, 27, 36, 0.5)", border: "1px solid var(--border)",
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{debaterInfo.displayName}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{side}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--primary-hover)", marginTop: 4 }}>{score}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────

function RoundTimer({ timerEnd, durationSec }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!timerEnd) { setRemaining(0); return; }

    const update = () => {
      const left = Math.max(0, timerEnd - Date.now());
      setRemaining(left);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [timerEnd]);

  const totalMs = durationSec * 1000;
  const pct = totalMs > 0 ? Math.min(100, (remaining / totalMs) * 100) : 0;
  const seconds = Math.ceil(remaining / 1000);
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;

  return (
    <div>
      <div className="round-timer-bar">
        <div className="round-timer-fill" style={{ width: `${pct}%` }} />
      </div>
      <div style={{ textAlign: "center", fontSize: 20, fontWeight: 700, color: remaining < 10000 ? "var(--danger)" : "#fff", fontVariantNumeric: "tabular-nums" }}>
        {min}:{sec.toString().padStart(2, "0")}
      </div>
    </div>
  );
}

function PredictionBar({ counts, sides }) {
  const total = sides.reduce((sum, s) => sum + (counts[s] || 0), 0);
  if (total === 0) return null;

  const colors = ["#3b5bdb", "#e03131"];

  return (
    <div className="prediction-bar">
      {sides.map((side, i) => {
        const pct = ((counts[side] || 0) / total) * 100;
        return (
          <div key={side} style={{
            width: `${Math.max(pct, 8)}%`,
            background: colors[i % colors.length],
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 700, color: "#fff",
            transition: "width 0.3s ease",
          }}>
            {side} {Math.round(pct)}%
          </div>
        );
      })}
    </div>
  );
}
