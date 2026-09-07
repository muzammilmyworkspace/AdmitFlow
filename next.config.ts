import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `next build` and `next dev` must not share an output directory. A production build
  // rewrites the chunk files a running dev server still holds references to, and the dev
  // server then dies with "Cannot find module './4447.js'" — an error that looks like a
  // code fault but is purely a clobbered build directory.
  //
  // The default `.next` is left to `build`/`start` so deployment tooling (which expects
  // exactly that path) is unaffected; only the dev script overrides it, via the env var
  // set in package.json.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Pin the file-tracing root to this project directory. Without this, Next's workspace-root
  // heuristic can walk up to the user's home directory on Windows and hit a restricted
  // junction (e.g. "Application Data"), failing the build with an unrelated EPERM error.
  outputFileTracingRoot: path.join(__dirname),
  // argon2 ships a native addon via node-pre-gyp; Next's file tracer (@vercel/nft) tries to
  // statically trace its binary-resolution logic, which on Windows walks os.homedir() and
  // hits the same restricted junction. Treating native-addon packages as external server
  // packages skips tracing them entirely (the standard fix for this class of package).
  serverExternalPackages: ["argon2"],
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {
    return [
      {
        // Baseline security headers per docs/14-security-architecture.md §9.
        // Route-specific overrides (e.g. a stricter CSP with nonces) live in src/middleware.ts.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
