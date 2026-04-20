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
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <WaveBackground />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

function WaveBackground() {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
      {/* Gradient base */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(20, 30, 60, 0.4) 0%, transparent 70%)",
      }} />
      {/* Waveform bars — ambient */}
      <svg viewBox="0 0 1200 400" preserveAspectRatio="none" style={{
        position: "absolute", bottom: 0, left: 0, width: "100%", height: "60%", opacity: 0.04,
      }}>
        {Array.from({ length: 120 }, (_, i) => {
          const h = 20 + Math.sin(i * 0.15) * 80 + Math.cos(i * 0.08) * 40;
          return (
            <rect key={i} x={i * 10} y={400 - h} width="3" height={h} fill="#4466aa" rx="1.5">
              <animate attributeName="height" values={`${h};${h * 1.3};${h * 0.7};${h}`} dur={`${2 + (i % 5) * 0.5}s`} repeatCount="indefinite" />
              <animate attributeName="y" values={`${400 - h};${400 - h * 1.3};${400 - h * 0.7};${400 - h}`} dur={`${2 + (i % 5) * 0.5}s`} repeatCount="indefinite" />
            </rect>
          );
        })}
      </svg>
      {/* Silhouette shapes */}
      <div style={{
        position: "absolute", bottom: 0, left: "15%", width: "200px", height: "300px",
        background: "radial-gradient(ellipse at 50% 80%, rgba(15, 20, 35, 0.9) 0%, transparent 70%)",
        filter: "blur(30px)", opacity: 0.5,
      }} />
      <div style={{
        position: "absolute", bottom: 0, right: "15%", width: "200px", height: "280px",
        background: "radial-gradient(ellipse at 50% 80%, rgba(15, 20, 35, 0.9) 0%, transparent 70%)",
        filter: "blur(30px)", opacity: 0.5,
      }} />
      {/* Subtle light leak */}
      <div style={{
        position: "absolute", bottom: "10%", left: "50%", transform: "translateX(-50%)",
        width: "400px", height: "2px",
        background: "linear-gradient(90deg, transparent, rgba(100, 140, 220, 0.15), transparent)",
      }} />
    </div>
  );
}
