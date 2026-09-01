import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module and the pg driver must not be bundled into the server build.
  serverExternalPackages: ["postgres", "@node-rs/argon2"],
  poweredByHeader: false,
};

export default nextConfig;
