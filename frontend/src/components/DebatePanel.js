"use client";

import { useState, useEffect } from "react";

const SIDE_COLORS = ["#3b5bdb", "#e03131"];

export default function DebatePanel({ session, userId, isCreator, socket, roomId, error }) {
  if (!session) return null;

  const isLive = session.status === "active";

  return (
    <div className={`debate-panel${isLive ? " debate-live" : ""}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 16 }}>⚔️</span>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: "var(--danger)" }}>
          DEBATE MODE
        </span>
        <span style={{
          fontSize: 10, padding: "3px 10px", borderRadius: 4,
          background: isLive ? "rgba(224, 49, 49, 0.15)" : "rgba(224, 49, 49, 0.1)",
          color: "var(--danger)", marginLeft: "auto", fontWeight: 600,
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

      {session.status === "setup" && <SetupPhase session={session} userId={userId} isCreator={isCreator} socket={socket} roomId={roomId} />}
      {session.status === "predictions" && <PredictionsPhase session={session} userId={userId} isCreator={isCreator} socket={socket} roomId={roomId} />}
      {session.status === "active" && <ActivePhase session={session} userId={userId} isCreator={isCreator} socket={socket} roomId={roomId} />}
      {session.status === "judging" && <JudgingPhase />}
      {session.status === "ended" && <EndedPhase session={session} />}
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

  const mySide = session.debaters[userId]?.side;

  const saveTopic = () => {
    if (!topic.trim()) return;
    socket.emit("debate-set-topic", {
      roomId, topic: topic.trim(), sides: [sideA.trim() || "For", sideB.trim() || "Against"],
    });
  };

  const joinSide = (side) => socket.emit("debate-register", { roomId, side });
  const leaveSide = () => socket.emit("debate-unregister", { roomId });

  const openPreds = () => {
    socket.emit("enable-debate-mode", {
      roomId, config: { rounds, durationSec: duration, sides: [sideA.trim() || "For", sideB.trim() || "Against"] },
    });
    setTimeout(() => socket.emit("debate-open-predictions", { roomId }), 100);
  };

  return (
    <div>
      {/* Topic */}
      {isCreator ? (
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 6, fontWeight: 600, letterSpacing: "0.05em" }}>DEBATE TOPIC</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Is AI good for society?" maxLength={200} style={{ flex: 1, fontSize: 15 }} />
            <button className="btn-primary" onClick={saveTopic} style={{ padding: "8px 20px", fontSize: 13 }}>Set</button>
          </div>
        </div>
      ) : session.topic ? (
        <div className="debate-topic-banner">{session.topic}</div>
      ) : null}

      {/* Side Labels (creator only) */}
      {isCreator && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 10, color: SIDE_COLORS[0], display: "block", marginBottom: 4, fontWeight: 700 }}>SIDE A</label>
            <input value={sideA} onChange={(e) => setSideA(e.target.value)} maxLength={40} style={{ fontSize: 13, borderColor: SIDE_COLORS[0] + "40" }} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: SIDE_COLORS[1], display: "block", marginBottom: 4, fontWeight: 700 }}>SIDE B</label>
            <input value={sideB} onChange={(e) => setSideB(e.target.value)} maxLength={40} style={{ fontSize: 13, borderColor: SIDE_COLORS[1] + "40" }} />
          </div>
        </div>
      )}

      {/* Round Config (creator only) */}
      {isCreator && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
          <div>
            <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4, fontWeight: 600 }}>ROUNDS</label>
            <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))} style={selectStyle}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} round{n > 1 ? "s" : ""}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4, fontWeight: 600 }}>ROUND TIME</label>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={selectStyle}>
              {[60, 90, 120, 180, 300].map((s) => <option key={s} value={s}>{s < 120 ? `${s}s` : `${s / 60}min`}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Side Selection */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 10, fontWeight: 600, letterSpacing: "0.05em" }}>PICK A SIDE</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {session.sides.map((side, i) => {
            const debater = Object.entries(session.debaters).find(([, d]) => d.side === side);
            const isMySide = mySide === side;
            const isTaken = debater && !isMySide;
            const color = SIDE_COLORS[i];
            return (
              <button key={side} onClick={() => isMySide ? leaveSide() : joinSide(side)} disabled={isTaken}
                style={{
                  padding: "16px", borderRadius: 10, fontSize: 14, fontWeight: 600,
                  background: isMySide ? color + "18" : "rgba(22, 27, 36, 0.5)",
                  border: isMySide ? `2px solid ${color}` : "1px solid var(--border)",
                  borderLeft: `3px solid ${color}`,
                  color: isTaken ? "var(--text-muted)" : isMySide ? color : "#fff",
                  opacity: isTaken ? 0.5 : 1, cursor: isTaken ? "not-allowed" : "pointer",
                }}
              >
                <div>{side}</div>
                {debater ? (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                    {debater[1].displayName}{isMySide ? " (You)" : ""}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Open</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Host Actions */}
      {isCreator && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn-primary" onClick={openPreds} style={{ fontSize: 13, padding: "12px 24px" }}>Open Predictions</button>
          <button className="btn-outline" onClick={() => socket.emit("debate-start", { roomId })} style={{ fontSize: 13, padding: "12px 24px" }}>Skip to Start</button>
        </div>
      )}
    </div>
  );
}

// ─── Predictions Phase ────────────────────────────────────────

function PredictionsPhase({ session, userId, isCreator, socket, roomId }) {
  const isDebater = !!session.debaters[userId];
  const totalVotes = session.predictions.totalVoters || 0;

  return (
    <div>
      {session.topic && <div className="debate-topic-banner">{session.topic}</div>}

      {/* VS Matchup */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, alignItems: "center", marginBottom: 20 }}>
        {session.sides.map((side, i) => {
          const debater = Object.entries(session.debaters).find(([, d]) => d.side === side);
          const color = SIDE_COLORS[i];
          return (
            <div key={side} style={{ textAlign: "center" }}>
              {debater?.[1]?.photoURL ? (
                <img src={debater[1].photoURL} alt="" style={{ width: 56, height: 56, borderRadius: "50%", margin: "0 auto 6px", display: "block", border: `3px solid ${color}` }} />
              ) : (
                <div style={{
                  width: 56, height: 56, borderRadius: "50%", margin: "0 auto 6px",
                  background: color + "30", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 22, fontWeight: 700, color: "#fff", border: `3px solid ${color}`,
                }}>
                  {(debater?.[1]?.displayName || "?")[0].toUpperCase()}
                </div>
              )}
              <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{debater?.[1]?.displayName || "?"}</div>
              <div style={{ fontSize: 11, color, fontWeight: 600 }}>{side}</div>
            </div>
          );
        }).reduce((acc, el, i) => {
          if (i === 1) return [...acc, <div key="vs" style={{ fontSize: 18, fontWeight: 800, color: "var(--text-muted)", letterSpacing: "0.1em" }}>VS</div>, el];
          return [...acc, el];
        }, [])}
      </div>

      {/* Prediction voting */}
      {!isDebater && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 10, textAlign: "center", fontWeight: 600 }}>
            WHO WILL WIN? ({totalVotes} vote{totalVotes !== 1 ? "s" : ""})
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {session.sides.map((side, i) => (
              <button key={side} onClick={() => socket.emit("debate-predict", { roomId, predictedSide: side })}
                className={`score-btn side-${i === 0 ? "a" : "b"}`} style={{ padding: "12px", fontSize: 14, fontWeight: 600 }}>
                {side}
              </button>
            ))}
          </div>
        </div>
      )}

      {isDebater && (
        <div style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>Debaters cannot vote on predictions.</div>
      )}

      {totalVotes > 0 && <PredictionBar counts={session.predictions.counts} sides={session.sides} />}

      {isCreator && (
        <button className="btn-primary" onClick={() => socket.emit("debate-start", { roomId })}
          style={{ width: "100%", marginTop: 16, fontSize: 15, padding: "14px", borderRadius: 10 }}>
          Start Debate
        </button>
      )}
    </div>
  );
}

// ─── Active Phase ─────────────────────────────────────────────

function ActivePhase({ session, userId, isCreator, socket, roomId }) {
  const isDebater = !!session.debaters[userId];

  return (
    <div>
      {session.topic && <div className="debate-topic-banner">{session.topic}</div>}

      {/* Round indicator */}
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--primary-hover)", letterSpacing: "0.08em" }}>
          ROUND {session.rounds.current} / {session.rounds.total}
        </span>
      </div>

      {/* Timer — bigger */}
      <RoundTimer timerEnd={session.rounds.timerEnd} durationSec={session.rounds.durationSec} />

      {/* Debaters + Scores — bigger, color-coded */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, margin: "20px 0" }}>
        {session.sides.map((side, i) => {
          const debater = Object.entries(session.debaters).find(([, d]) => d.side === side);
          if (!debater) return null;
          const [debaterId, debaterInfo] = debater;
          const score = session.scores[debaterId] || 0;
          const color = SIDE_COLORS[i];

          return (
            <div key={side} className={`debater-card side-${i === 0 ? "a" : "b"}`}
              style={{ textAlign: "center", padding: "20px 16px", borderRadius: 12, background: "rgba(22, 27, 36, 0.5)" }}>
              {debaterInfo.photoURL ? (
                <img src={debaterInfo.photoURL} alt="" style={{ width: 64, height: 64, borderRadius: "50%", margin: "0 auto 8px", display: "block", border: `3px solid ${color}` }} />
              ) : (
                <div style={{
                  width: 64, height: 64, borderRadius: "50%", margin: "0 auto 8px",
                  background: color + "30", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 24, fontWeight: 700, color: "#fff", border: `3px solid ${color}`,
                }}>
                  {(debaterInfo.displayName || "?")[0].toUpperCase()}
                </div>
              )}
              <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{debaterInfo.displayName}</div>
              <div style={{ fontSize: 11, color, fontWeight: 600, marginBottom: 8 }}>{side}</div>
              <div className="debate-score" style={{ color }}>{score}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 8 }}>points</div>

              {/* Score buttons for audience */}
              {!isDebater && (
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                  <button onClick={() => socket.emit("debate-score", { roomId, targetUserId: debaterId, score: 1 })}
                    style={{ padding: "8px 18px", borderRadius: 8, fontSize: 18, background: "rgba(47, 158, 68, 0.1)", border: "1px solid rgba(47, 158, 68, 0.2)", color: "var(--success)", cursor: "pointer" }}>
                    👍
                  </button>
                  <button onClick={() => socket.emit("debate-score", { roomId, targetUserId: debaterId, score: -1 })}
                    style={{ padding: "8px 18px", borderRadius: 8, fontSize: 18, background: "rgba(224, 49, 49, 0.1)", border: "1px solid rgba(224, 49, 49, 0.2)", color: "var(--danger)", cursor: "pointer" }}>
                    👎
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isDebater && (
        <div style={{ textAlign: "center", fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>
          You're debating — make your case!
        </div>
      )}

      {isCreator && (
        <button className="btn-danger" onClick={() => socket.emit("debate-end", { roomId })}
          style={{ width: "100%", marginTop: 16, fontSize: 13, padding: "12px" }}>
          End Debate Early
        </button>
      )}
    </div>
  );
}

// ─── Judging Phase ────────────────────────────────────────────

function JudgingPhase() {
  return (
    <div style={{ textAlign: "center", padding: "32px 0" }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>🧠</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginBottom: 8 }}>AI Judge Deliberating...</div>
      <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Analyzing arguments and scores</div>
      <div style={{ marginTop: 20 }}>
        <div style={{
          width: 36, height: 36, border: "2px solid var(--border)", borderTopColor: "var(--primary)",
          borderRadius: "50%", margin: "0 auto", animation: "spin 1s linear infinite",
        }} />
      </div>
    </div>
  );
}

// ─── Ended Phase ──────────────────────────────────────────────

function EndedPhase({ session }) {
  return (
    <div style={{ textAlign: "center", padding: "20px 0" }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Debate Ended</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {session.sides.map((side, i) => {
          const debater = Object.entries(session.debaters).find(([, d]) => d.side === side);
          if (!debater) return null;
          const [debaterId, debaterInfo] = debater;
          const score = session.scores[debaterId] || 0;
          const color = SIDE_COLORS[i];
          return (
            <div key={side} style={{
              padding: 16, borderRadius: 10,
              background: "rgba(22, 27, 36, 0.5)", border: `1px solid ${color}30`, borderLeft: `3px solid ${color}`,
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{debaterInfo.displayName}</div>
              <div style={{ fontSize: 11, color, fontWeight: 600 }}>{side}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 8 }}>{score}</div>
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
    const update = () => setRemaining(Math.max(0, timerEnd - Date.now()));
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
      <div style={{
        textAlign: "center", fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums",
        color: remaining < 10000 ? "var(--danger)" : "#fff",
      }}>
        {min}:{sec.toString().padStart(2, "0")}
      </div>
    </div>
  );
}

function PredictionBar({ counts, sides }) {
  const total = sides.reduce((sum, s) => sum + (counts[s] || 0), 0);
  if (total === 0) return null;

  return (
    <div className="prediction-bar">
      {sides.map((side, i) => {
        const pct = ((counts[side] || 0) / total) * 100;
        return (
          <div key={side} style={{
            width: `${Math.max(pct, 8)}%`, background: SIDE_COLORS[i],
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 700, color: "#fff", transition: "width 0.3s ease",
          }}>
            {side} {Math.round(pct)}%
          </div>
        );
      })}
    </div>
  );
}

const selectStyle = {
  width: "100%", padding: "10px 12px", fontSize: 13,
  background: "rgba(15, 18, 24, 0.8)", border: "1px solid var(--border)",
  borderRadius: 6, color: "var(--text)",
};
