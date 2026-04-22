"use client";

import { useState, useEffect } from "react";

/**
 * Cinematic winner reveal overlay.
 * Animation sequence:
 *  0ms    — overlay fades in (CSS)
 *  500ms  — "Backchannel AI Judge" label
 *  800ms  — "Reviewing arguments..."
 *  1200ms — winner avatar zooms in with glow
 *  1600ms — winner name + trophy
 *  1900ms — summary text
 *  4000ms — dismiss button
 *  8000ms — auto-dismiss safety net
 */
export default function WinnerReveal({ winner, onDismiss }) {
  const [phase, setPhase] = useState(0);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => setPhase(3), 1200),
      setTimeout(() => setPhase(4), 1600),
      setTimeout(() => setPhase(5), 1900),
      setTimeout(() => setPhase(6), 4000),
      // Safety: auto-dismiss after 8s to never block permanently
      setTimeout(() => onDismiss?.(), 8000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onDismiss]);

  if (!winner) return null;

  const isTie = winner.winnerSide === "tie";
  const hasAvatar = winner.winnerPhotoURL && !imgError && !isTie;

  return (
    <div className="winner-overlay" onClick={(e) => { if (phase >= 6) onDismiss?.(); }}>
      <div style={{ textAlign: "center", maxWidth: 400, padding: "0 24px" }}>

        {/* Phase 1: AI Judge label */}
        <div style={{
          opacity: phase >= 1 ? 1 : 0,
          transform: phase >= 1 ? "translateY(0)" : "translateY(8px)",
          transition: "all 0.3s ease-out",
          marginBottom: 16,
        }}>
          <span style={{ fontSize: 28 }}>🧠</span>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
            color: "rgba(139, 92, 246, 0.9)", marginTop: 8,
          }}>
            BACKCHANNEL AI JUDGE
          </div>
        </div>

        {/* Phase 2: Reviewing text */}
        <div style={{
          opacity: phase >= 2 ? (phase >= 3 ? 0 : 1) : 0,
          transition: "opacity 0.3s ease",
          fontSize: 14, color: "var(--text-muted)", marginBottom: 24,
          height: phase >= 3 ? 0 : "auto",
          overflow: "hidden",
        }}>
          Reviewing arguments...
        </div>

        {/* Phase 3: Winner avatar */}
        {phase >= 3 && (
          <div style={{ marginBottom: 20 }}>
            {hasAvatar ? (
              <img
                src={winner.winnerPhotoURL}
                alt=""
                onError={() => setImgError(true)}
                className="winner-avatar winner-glow"
                style={{
                  width: 96, height: 96, borderRadius: "50%",
                  border: "3px solid var(--primary)",
                  display: "block", margin: "0 auto",
                }}
              />
            ) : (
              <div
                className="winner-avatar winner-glow"
                style={{
                  width: 96, height: 96, borderRadius: "50%",
                  background: isTie
                    ? "linear-gradient(135deg, #f59f00, #e03131)"
                    : "linear-gradient(135deg, #3b5bdb, #6c5ce7)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto",
                  fontSize: 36, fontWeight: 700, color: "#fff",
                  border: "3px solid var(--primary)",
                }}
              >
                {isTie ? "=" : (winner.winnerDisplayName || "?")[0].toUpperCase()}
              </div>
            )}
          </div>
        )}

        {/* Phase 4: Winner name */}
        <div className={phase >= 4 ? "winner-text" : ""} style={{
          opacity: phase >= 4 ? undefined : 0,
        }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4 }}>
            {isTie ? "RESULT" : (winner.method === "ai-judge" ? "AI VERDICT" : "WINNER BY SCORE")}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#fff" }}>
            {isTie ? "🤝 It's a Tie!" : `🏆 ${winner.winnerDisplayName}`}
          </div>
          {!isTie && winner.winnerSide && (
            <div style={{
              fontSize: 12, marginTop: 6,
              padding: "2px 10px", borderRadius: 4, display: "inline-block",
              background: "rgba(59, 91, 219, 0.15)", color: "var(--primary-hover)",
            }}>
              Side: {winner.winnerSide}
            </div>
          )}
        </div>

        {/* Phase 5: Summary */}
        <div className={phase >= 5 ? "winner-summary" : ""} style={{
          opacity: phase >= 5 ? undefined : 0,
          marginTop: 20,
          fontSize: 14, color: "var(--text)", lineHeight: 1.6,
          background: "rgba(99, 102, 241, 0.08)",
          border: "1px solid rgba(99, 102, 241, 0.15)",
          borderRadius: 10, padding: "14px 18px",
        }}>
          {winner.summary}
        </div>

        {/* Phase 6: Dismiss button */}
        {phase >= 6 && (
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss?.(); }}
            className="btn-outline"
            style={{
              marginTop: 28, padding: "10px 32px", fontSize: 13,
              animation: "winnerTextIn 0.3s ease-out forwards",
            }}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}
