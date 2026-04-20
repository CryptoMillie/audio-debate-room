const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const routes = require("./routes");
const { setupSocket, getActiveUserCount } = require("./socket");
const { getDb } = require("./db");

const app = express();
const server = http.createServer(app);

// Allow local dev + production frontend
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  process.env.FRONTEND_URL, // Set this on Railway to your Vercel URL
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
  },
});

app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: "1mb" }));

// REST API routes
app.use("/api", routes);

// Health check
app.get("/", (_req, res) => {
  res.json({
    status: "Audio Debate Room server running",
    turnConfigured: !!process.env.METERED_API_KEY,
    meteredApp: process.env.METERED_APP_NAME || "backchannel",
  });
});

// Stats endpoint
app.get("/api/stats", (_req, res) => {
  res.json({ activeUsers: getActiveUserCount() });
});

// TURN credential endpoint — fetches temporary TURN credentials
app.get("/api/turn-credentials", async (_req, res) => {
  const apiKey = process.env.METERED_API_KEY;
  if (!apiKey) {
    console.log("TURN: No METERED_API_KEY set, returning STUN-only");
    return res.json({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
      ],
    });
  }
  try {
    const appName = process.env.METERED_APP_NAME || "backchannel";
    const url = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`;
    console.log("TURN: Fetching from", url.replace(apiKey, "***"));
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      console.error("TURN: Metered API error:", response.status, text);
      throw new Error(`Metered API returned ${response.status}`);
    }
    const iceServers = await response.json();
    console.log("TURN: Got", iceServers.length, "ICE servers");
    res.json({ iceServers });
  } catch (err) {
    console.error("TURN: Failed to fetch credentials:", err.message);
    res.json({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
  }
});

// Initialize Socket.IO signaling
setupSocket(io);

const PORT = process.env.PORT || 3001;

// Initialize DB then start server
getDb().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error("Failed to initialize database:", err);
  process.exit(1);
});
