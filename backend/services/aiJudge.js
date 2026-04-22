/**
 * AI Judge service using Chutes API (DeepSeek V3)
 * Generates debate summary and winner declaration.
 * Same API pattern as factcheck.js.
 */

async function generateJudgeSummary(session) {
  const apiKey = process.env.CHUTES_API_KEY;
  if (!apiKey) {
    return { winner: null, summary: "AI Judge unavailable: CHUTES_API_KEY not configured." };
  }

  // Build debater info per side
  const sideInfo = {};
  for (const [uid, d] of Object.entries(session.debaters)) {
    if (!sideInfo[d.side]) sideInfo[d.side] = [];
    sideInfo[d.side].push({ name: d.displayName, score: session.scores[uid] || 0 });
  }

  const sidesDescription = session.sides
    .map((side) => {
      const debaters = sideInfo[side] || [];
      const names = debaters.map((d) => `${d.name} (${d.score} pts)`).join(", ");
      return `Side "${side}": ${names || "No debaters"}`;
    })
    .join("\n");

  const roundSummary = session.rounds.history
    .map((r) => {
      const scores = Object.entries(r.scores)
        .map(([uid, s]) => `${session.debaters[uid]?.displayName || uid}: ${s}`)
        .join(", ");
      return `Round ${r.round}: ${scores}`;
    })
    .join("\n");

  const factSummary = (session.factChecks || [])
    .slice(-5) // Last 5 fact checks
    .map((f) => `Q: "${f.query}" → ${f.result}`)
    .join("\n");

  const prompt = `Topic: "${session.topic}"

${sidesDescription}

Round-by-round scores:
${roundSummary || "No round data available."}

${factSummary ? `Fact-checks referenced during debate:\n${factSummary}` : ""}

Based on the scores and debate structure, declare a winner (one of: ${session.sides.map((s) => `"${s}"`).join(", ")}, or "tie") and explain in 2-3 concise sentences why they won. Be fair and neutral.

Respond in this exact format:
WINNER: <side>
SUMMARY: <your 2-3 sentence explanation>`;

  try {
    const res = await fetch("https://llm.chutes.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-ai/DeepSeek-V3-0324",
        messages: [
          {
            role: "system",
            content:
              "You are an impartial debate judge for a live debate room called Backchannel. You evaluate debates based on argument scores and factual accuracy. Be concise, fair, and decisive.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 250,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`AI Judge API error ${res.status}: ${errText}`);
      return { winner: null, summary: "AI Judge could not reach a verdict. Falling back to scores." };
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || "";

    // Parse structured response
    const winnerMatch = text.match(/WINNER:\s*(.+)/i);
    const summaryMatch = text.match(/SUMMARY:\s*(.+)/is);

    let winner = winnerMatch ? winnerMatch[1].trim() : null;
    const summary = summaryMatch ? summaryMatch[1].trim() : text;

    // Normalize winner to match a side
    if (winner) {
      const matchedSide = session.sides.find(
        (s) => s.toLowerCase() === winner.toLowerCase()
      );
      winner = matchedSide || (winner.toLowerCase() === "tie" ? "tie" : null);
    }

    return { winner, summary };
  } catch (err) {
    console.error("AI Judge call failed:", err.message);
    return { winner: null, summary: "AI Judge encountered an error. Falling back to scores." };
  }
}

module.exports = { generateJudgeSummary };
