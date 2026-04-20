import { AuthProvider } from "@/lib/AuthContext";
import "./globals.css";

export const metadata = {
  title: "Backchannel",
  description: "Real-time audio rooms",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body>
        <GraffitiBackground />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

function GraffitiBackground() {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden", background: "#050507" }}>
      {/* SVG graffiti layer */}
      <svg viewBox="0 0 1400 900" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 1 }}>
        <defs>
          <filter id="spray" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" />
          </filter>
          <filter id="glow">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="roughEdge">
            <feTurbulence type="turbulence" baseFrequency="0.05" numOctaves="2" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" />
          </filter>
        </defs>

        {/* Large white slash strokes — like spray sweeps */}
        <line x1="100" y1="50" x2="400" y2="300" stroke="rgba(255,255,255,0.04)" strokeWidth="45" strokeLinecap="round" />
        <line x1="350" y1="100" x2="200" y2="400" stroke="rgba(255,255,255,0.03)" strokeWidth="60" strokeLinecap="round" />
        <line x1="900" y1="150" x2="1100" y2="50" stroke="rgba(255,255,255,0.035)" strokeWidth="35" strokeLinecap="round" />

        {/* Orange tag scrawl */}
        <g filter="url(#roughEdge)" opacity="0.06">
          <path d="M180 380 Q220 340 260 370 Q300 400 340 360 Q370 330 410 370" stroke="#ff6b35" strokeWidth="8" fill="none" strokeLinecap="round" />
          <path d="M190 395 Q230 360 270 385 Q310 415 350 375" stroke="#ff6b35" strokeWidth="5" fill="none" strokeLinecap="round" />
        </g>

        {/* Yellow loops — bottom left */}
        <g filter="url(#roughEdge)" opacity="0.05">
          <ellipse cx="150" cy="700" rx="80" ry="90" stroke="#f7d800" strokeWidth="7" fill="none" />
          <ellipse cx="200" cy="750" rx="60" ry="50" stroke="#f7d800" strokeWidth="5" fill="none" />
          <path d="M100 650 Q130 600 180 640 Q220 670 200 720" stroke="#f7d800" strokeWidth="6" fill="none" strokeLinecap="round" />
        </g>

        {/* Cyan tag — top right */}
        <g filter="url(#roughEdge)" opacity="0.05">
          <text x="950" y="200" fontFamily="Impact, sans-serif" fontSize="55" fill="none" stroke="#5ce1e6" strokeWidth="2" transform="rotate(-5 950 200)">BACK</text>
          <text x="980" y="260" fontFamily="Impact, sans-serif" fontSize="48" fill="none" stroke="#5ce1e6" strokeWidth="1.5" transform="rotate(-3 980 260)">CHANNEL</text>
        </g>

        {/* White scribble circles — center right */}
        <g opacity="0.03">
          <circle cx="1100" cy="600" r="70" stroke="#fff" strokeWidth="3" fill="none" />
          <circle cx="1120" cy="620" r="55" stroke="#fff" strokeWidth="2" fill="none" />
          <path d="M1050 580 Q1100 540 1150 580 Q1180 620 1140 660" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" />
        </g>

        {/* Red drip lines — top */}
        <g opacity="0.04">
          <line x1="600" y1="0" x2="600" y2="120" stroke="#e03131" strokeWidth="3" strokeLinecap="round" />
          <line x1="620" y1="0" x2="620" y2="90" stroke="#e03131" strokeWidth="2" strokeLinecap="round" />
          <line x1="640" y1="0" x2="640" y2="150" stroke="#e03131" strokeWidth="4" strokeLinecap="round" />
          <line x1="660" y1="0" x2="660" y2="70" stroke="#e03131" strokeWidth="2" strokeLinecap="round" />
          <circle cx="640" cy="155" r="4" fill="#e03131" opacity="0.6" />
        </g>

        {/* Small tags scattered */}
        <text x="50" y="150" fontFamily="'Courier New', monospace" fontSize="14" fill="rgba(255,255,255,0.04)" transform="rotate(-15 50 150)">NO CAP</text>
        <text x="1200" y="400" fontFamily="Impact, sans-serif" fontSize="18" fill="rgba(255,107,53,0.04)" transform="rotate(8 1200 400)">LIVE</text>
        <text x="700" y="800" fontFamily="'Courier New', monospace" fontSize="12" fill="rgba(255,255,255,0.03)" transform="rotate(-3 700 800)">unmuted</text>
        <text x="300" y="550" fontFamily="Impact, sans-serif" fontSize="16" fill="rgba(92,225,230,0.03)" transform="rotate(12 300 550)">RAW</text>
        <text x="1100" y="180" fontFamily="'Courier New', monospace" fontSize="11" fill="rgba(247,216,0,0.035)" transform="rotate(-6 1100 180)">m.80</text>

        {/* Big swooping white arc */}
        <path d="M50 500 Q400 200 750 450 Q900 550 1000 400" stroke="rgba(255,255,255,0.025)" strokeWidth="50" fill="none" strokeLinecap="round" />

        {/* Drip dots */}
        <circle cx="605" cy="125" r="3" fill="rgba(224,49,49,0.04)" />
        <circle cx="185" cy="410" r="2.5" fill="rgba(255,107,53,0.05)" />
        <circle cx="155" cy="800" r="3" fill="rgba(247,216,0,0.04)" />
      </svg>

      {/* Noise texture overlay */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E")`,
        backgroundRepeat: "repeat",
        opacity: 0.4,
      }} />

      {/* Dark vignette */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at 50% 50%, transparent 30%, rgba(0,0,0,0.6) 100%)",
      }} />
    </div>
  );
}
