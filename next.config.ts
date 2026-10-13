import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Only badcodes.dev may frame the site (the portfolio embeds it, click to load, on its project
  // page); every other site is refused.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self' https://badcodes.dev https://www.badcodes.dev" }],
      },
    ];
  },
};

export default nextConfig;
