# Audio Debate Room

A real-time audio debate platform where users can create rooms and talk via WebRTC peer-to-peer audio.

## Tech Stack

| Layer     | Technology                     |
|-----------|-------------------------------|
| Frontend  | Next.js 14 (React)            |
| Backend   | Node.js + Express             |
| Realtime  | Socket.IO (signaling server)  |
| Audio     | WebRTC via simple-peer        |
| Auth      | Firebase Google Authentication|
| Database  | SQLite (via better-sqlite3)   |

## Prerequisites

- Node.js 18+
- A Firebase project with Google Auth enabled

## Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project (or use an existing one)
3. Enable **Authentication** → **Sign-in method** → **Google**
4. Go to **Project Settings** → **General** → **Your apps** → **Add web app**
5. Copy the Firebase config values

## Local Setup

### 1. Clone and install

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Configure environment

```bash
# Frontend: copy and fill in your Firebase config
cp frontend/.env.local.example frontend/.env.local
# Edit frontend/.env.local with your Firebase credentials
```

### 3. Run the app

Open two terminals:

```bash
# Terminal 1 — Backend (runs on port 3001)
cd backend
node server.js

# Terminal 2 — Frontend (runs on port 3000)
cd frontend
npm run dev
```

### 4. Test it

1. Open `http://localhost:3000` in your browser
2. Sign in with Google
3. Create a room
4. Open `http://localhost:3000` in a second browser tab (or incognito)
5. Sign in with a different Google account (or the same one)
6. Join the same room via the room list or Room ID
7. Both users click "Join Voice" — you should hear audio between tabs

> **Tip:** Use headphones to avoid echo feedback when testing in two tabs on the same machine.

## Project Structure

```
audio-debate-room/
├── backend/
│   ├── server.js        # Express + Socket.IO entry point
│   ├── routes.js        # REST API routes (create/join/list rooms)
│   ├── socket.js        # Socket.IO WebRTC signaling logic
│   ├── db.js            # SQLite database setup and schema
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.js          # Root layout with AuthProvider
│   │   │   ├── page.js            # Dashboard (create/join rooms)
│   │   │   ├── globals.css        # Global styles
│   │   │   └── room/[id]/page.js  # Room page (audio + participants)
│   │   ├── lib/
│   │   │   ├── firebase.js        # Firebase init and Google auth
│   │   │   ├── api.js             # Backend API client
│   │   │   ├── socket.js          # Socket.IO client singleton
│   │   │   └── AuthContext.js     # React auth context provider
│   │   └── components/
│   ├── next.config.js
│   └── package.json
└── README.md
```

## How WebRTC Signaling Works

WebRTC enables direct peer-to-peer audio between browsers, but peers need a way
to exchange connection metadata first. This is called **signaling**.

```
Browser A                  Server (Socket.IO)              Browser B
    |                            |                            |
    |--- join-room ------------->|                            |
    |                            |--- user-connected -------->|
    |                            |                            |
    |                            |<--- SDP Offer (signal) ----|
    |<--- SDP Offer (signal) ---|                            |
    |                            |                            |
    |--- SDP Answer (signal) -->|                            |
    |                            |--- SDP Answer (signal) -->|
    |                            |                            |
    |--- ICE candidates ------->|                            |
    |                            |--- ICE candidates -------->|
    |<--- ICE candidates -------|                            |
    |                            |<--- ICE candidates --------|
    |                            |                            |
    |<========== Direct P2P Audio Connection ================>|
```

1. User A joins a room; server notifies User B
2. User B creates an SDP "offer" and sends it via the signaling server
3. User A receives the offer, creates an SDP "answer", sends it back
4. Both exchange ICE candidates (network path info)
5. A direct P2P connection is established — audio flows directly between browsers

The server is only involved in signaling. Once connected, audio does NOT go through the server.

## API Reference

| Method | Endpoint        | Body                      | Description          |
|--------|----------------|---------------------------|----------------------|
| POST   | /api/create-room | `{ title, userId }`      | Create a new room    |
| GET    | /api/rooms/:id   | —                        | Get room details     |
| POST   | /api/join-room   | `{ roomId, userId }`     | Join a room          |
| GET    | /api/rooms       | —                        | List all rooms       |
| POST   | /api/auth/user   | `{ id, email, ... }`     | Upsert user record   |

## Socket Events

| Event             | Direction       | Payload                              | Description                        |
|-------------------|-----------------|--------------------------------------|------------------------------------|
| join-room         | Client → Server | `{ roomId, userId, displayName }`   | Join a voice room                  |
| existing-users    | Server → Client | `[{ socketId, userId, displayName }]`| Users already in room             |
| user-connected    | Server → Client | `{ socketId, userId, displayName }` | New user joined                    |
| user-disconnected | Server → Client | `{ socketId, userId, displayName }` | User left                          |
| signal            | Bidirectional   | `{ targetSocketId/fromSocketId, signal }` | WebRTC signaling data        |
