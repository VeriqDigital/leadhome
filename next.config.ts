import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Next 16.2's React debug channel can mistake an in-flight Firefox
    // navigation for a cache restore (transferSize === 0) and repeatedly call
    // location.reload() when its session entry is not available. Keep the
    // optional development channel disabled until the upstream fallback is
    // safe; this does not affect production rendering or application data.
    reactDebugChannel: false,
  },
};

export default nextConfig;
