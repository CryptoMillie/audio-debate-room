const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb, saveDb } = require("./db");

const router = express.Router();

// Upsert user (called after Firebase auth on the client)
router.post("/auth/user", async (req, res) => {
  try {
    const { id, email, displayName, photoURL } = req.body;
    if (!id || !email) {
      return res.status(400).json({ error: "id and email are required" });
    }

    const db = await getDb();

    // Check if user exists
    const existing = db.exec("SELECT id FROM users WHERE id = ?", [id]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      db.run("UPDATE users SET email = ?, display_name = ?, photo_url = ? WHERE id = ?",
        [email, displayName || null, photoURL || null, id]);
    } else {
      db.run("INSERT INTO users (id, email, display_name, photo_url) VALUES (?, ?, ?, ?)",
        [id, email, displayName || null, photoURL || null]);
    }
    saveDb();

    res.json({ success: true });
  } catch (err) {
    console.error("auth/user error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /create-room
router.post("/create-room", async (req, res) => {
  try {
    const { title, userId } = req.body;
    if (!title || !userId) {
      return res.status(400).json({ error: "title and userId are required" });
    }

    const db = await getDb();
    const roomId = uuidv4().slice(0, 8);
    db.run("INSERT INTO rooms (id, title, created_by) VALUES (?, ?, ?)", [roomId, title, userId]);
    saveDb();

    res.json({ roomId, title });
  } catch (err) {
    console.error("create-room error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /rooms/:id
router.get("/rooms/:id", async (req, res) => {
  try {
    const db = await getDb();
    const roomResult = db.exec("SELECT * FROM rooms WHERE id = ?", [req.params.id]);

    if (roomResult.length === 0 || roomResult[0].values.length === 0) {
      return res.status(404).json({ error: "Room not found" });
    }

    const cols = roomResult[0].columns;
    const vals = roomResult[0].values[0];
    const room = {};
    cols.forEach((col, i) => { room[col] = vals[i]; });

    const partResult = db.exec(`
      SELECT u.id, u.display_name, u.photo_url
      FROM room_participants rp
      JOIN users u ON u.id = rp.user_id
      WHERE rp.room_id = ?
    `, [req.params.id]);

    const participants = [];
    if (partResult.length > 0) {
      const pCols = partResult[0].columns;
      partResult[0].values.forEach((row) => {
        const p = {};
        pCols.forEach((col, i) => { p[col] = row[i]; });
        participants.push(p);
      });
    }

    res.json({ ...room, participants });
  } catch (err) {
    console.error("rooms/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /join-room
router.post("/join-room", async (req, res) => {
  try {
    const { roomId, userId } = req.body;
    if (!roomId || !userId) {
      return res.status(400).json({ error: "roomId and userId are required" });
    }

    const db = await getDb();
    const roomResult = db.exec("SELECT id FROM rooms WHERE id = ?", [roomId]);
    if (roomResult.length === 0 || roomResult[0].values.length === 0) {
      return res.status(404).json({ error: "Room not found" });
    }

    // Insert if not already a participant
    const existing = db.exec(
      "SELECT room_id FROM room_participants WHERE room_id = ? AND user_id = ?",
      [roomId, userId]
    );
    if (existing.length === 0 || existing[0].values.length === 0) {
      db.run("INSERT INTO room_participants (room_id, user_id) VALUES (?, ?)", [roomId, userId]);
      saveDb();
    }

    res.json({ success: true, roomId });
  } catch (err) {
    console.error("join-room error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /rooms — List all rooms
router.get("/rooms", async (_req, res) => {
  try {
    const db = await getDb();
    const result = db.exec(`
      SELECT r.*, u.display_name as creator_name,
        (SELECT COUNT(*) FROM room_participants WHERE room_id = r.id) as participant_count
      FROM rooms r
      LEFT JOIN users u ON u.id = r.created_by
      ORDER BY r.created_at DESC
    `);

    const rooms = [];
    if (result.length > 0) {
      const cols = result[0].columns;
      result[0].values.forEach((row) => {
        const room = {};
        cols.forEach((col, i) => { room[col] = row[i]; });
        rooms.push(room);
      });
    }

    res.json(rooms);
  } catch (err) {
    console.error("rooms error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
