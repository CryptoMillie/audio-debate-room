const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const routes = require("./routes");
const { setupSocket } = require("./socket");
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
app.use(express.json());

// REST API routes
app.use("/api", routes);

// Health check
app.get("/", (_req, res) => {
  res.json({ status: "Audio Debate Room server running" });
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
