/**
 * AI Fact-Checker service using Chutes API (DeepSeek V3)
 * Handles cooldowns, validation, and API calls for /fact command
 */

const userLastRequest = new Map();  // userId -> timestamp
const roomLastRequest = new Map();  // roomId -> timestamp
const roomFactCount = new Map();    // roomId -> count

const USER_COOLDOWN_MS = 15000;
const ROOM_COOLDOWN_MS = 5000;

function checkCooldown(userId, roomId) {
  const now = Date.now();

  const userLast = userLastRequest.get(userId);
  if (userLast && now - userLast < USER_COOLDOWN_MS) {
    const wait = Math.ceil((USER_COOLDOWN_MS - (now - userLast)) / 1000);
    return { allowed: false, message: `Cooldown: wait ${wait}s before your next /fact` };
  }

  const roomLast = roomLastRequest.get(roomId);
  if (roomLast && now - roomLast < ROOM_COOLDOWN_MS) {
    const wait = Math.ceil((ROOM_COOLDOWN_MS - (now - roomLast)) / 1000);
    return { allowed: false, message: `Room cooldown: wait ${wait}s` };
  }

  return { allowed: true };
}

function validateQuery(query) {
  const trimmed = (query || "").trim();
  if (trimmed.length < 10) {
    return { valid: false, message: "Query too short — minimum 10 characters for a fact check." };
  }
  if (trimmed.length > 300) {
    return { valid: false, message: "Query too long — maximum 300 characters." };
  }
  return { valid: true, trimmed };
}

async function callChutesAPI(query) {
  const apiKey = process.env.CHUTES_API_KEY;
  if (!apiKey) {
    return "Fact-checker unavailable: CHUTES_API_KEY not configured.";
  }

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
              "You are a real-time fact checker in a live debate room. Respond in 2-3 concise sentences. Be neutral, accurate, and say if uncertain.",
          },
          { role: "user", content: query },
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`Chutes API error ${res.status}: ${errText}`);
      return "Fact-check failed — API returned an error. Try again later.";
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || "No response from AI.";
  } catch (err) {
    console.error("Chutes API call failed:", err.message);
    return "Fact-check failed — could not reach AI service.";
  }
}

async function handleFactCheck(userId, roomId, query) {
  // Cooldown check
  const cooldown = checkCooldown(userId, roomId);
  if (!cooldown.allowed) {
    return { type: "error", text: cooldown.message, originalQuery: query };
  }

  // Validation
  const validation = validateQuery(query);
  if (!validation.valid) {
    return { type: "error", text: validation.message, originalQuery: query };
  }

  // Update timestamps
  const now = Date.now();
  userLastRequest.set(userId, now);
  roomLastRequest.set(roomId, now);
  roomFactCount.set(roomId, (roomFactCount.get(roomId) || 0) + 1);

  // Call API
  const response = await callChutesAPI(validation.trimmed);
  return { type: "fact", text: response, originalQuery: validation.trimmed };
}

module.exports = { handleFactCheck };
