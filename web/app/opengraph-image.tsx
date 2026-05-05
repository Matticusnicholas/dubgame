import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Stupid Dubbing — a party game";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "linear-gradient(135deg, #0b0b10 0%, #1a1a2e 100%)",
          color: "#f5f5f7",
          fontFamily: "system-ui, sans-serif",
          padding: "80px",
        }}
      >
        <div
          style={{
            fontSize: 36,
            opacity: 0.6,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            marginBottom: 20,
          }}
        >
          dubgame.app
        </div>
        <div
          style={{
            fontSize: 110,
            fontWeight: 900,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            textAlign: "center",
            marginBottom: 40,
          }}
        >
          Stupid Dubbing
        </div>
        <div
          style={{
            fontSize: 38,
            opacity: 0.85,
            textAlign: "center",
            maxWidth: 900,
            lineHeight: 1.3,
          }}
        >
          🔇 The dialogue cuts out. You make it up. The room votes for the funniest dub.
        </div>
        <div
          style={{
            display: "flex",
            gap: 24,
            marginTop: 60,
            fontSize: 28,
            opacity: 0.7,
          }}
        >
          <span>🤖 Robot voices</span>
          <span>·</span>
          <span>📱 Phones join with a 5-letter code</span>
          <span>·</span>
          <span>🆓 Free</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
