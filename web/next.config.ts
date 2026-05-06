import type { NextConfig } from "next";

const HEAVY_CLIENT_DEPS = [
  "**/node_modules/onnxruntime-node/**",
  "**/node_modules/onnxruntime-web/**",
  "**/node_modules/@huggingface/**",
  "**/node_modules/kokoro-js/**",
  "**/node_modules/@ffmpeg/**",
  "**/node_modules/@img/**",
  "**/node_modules/sharp/**",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Big client-only deps (TTS engine, ffmpeg.wasm) get dynamically imported
  // in browser code. Without this, Next's tracer pulls them into the server
  // bundle for every page that touches the import chain, blowing past
  // Vercel's 250 MB serverless function limit.
  outputFileTracingExcludes: {
    "/host/[code]": HEAVY_CLIENT_DEPS,
    "/play/[code]": HEAVY_CLIENT_DEPS,
    "/solo": HEAVY_CLIENT_DEPS,
  },
  async headers() {
    return [
      {
        // Aggressive caching for the immutable clip mp4s — browser keeps them
        // forever, Vercel's edge caches them between requests so origin
        // bandwidth stays near zero.
        source: "/clips/:file*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/intro.mp4",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
