import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // `pg` and `nodemailer` are Node-only; keep them out of the bundle.
  serverExternalPackages: ["pg", "nodemailer"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default config;
