import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Kokoro / transformers / onnxruntime-node are dynamically imported and only
  // used client-side. Without this, Next's tracer pulls them into the server
  // bundle for /host/[code], blowing past Vercel's 250 MB function size limit.
  outputFileTracingExcludes: {
    "/host/[code]": [
      "**/node_modules/onnxruntime-node/**",
      "**/node_modules/onnxruntime-web/**",
      "**/node_modules/@huggingface/**",
      "**/node_modules/kokoro-js/**",
      "**/node_modules/@img/**",
      "**/node_modules/sharp/**",
    ],
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
