import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Developer CLI scripts print to stdout by design — that's their whole interface,
    // unlike application code which must go through the structured logger.
    files: ["scripts/**/*.mjs", "prisma/seed*.ts"],
    rules: { "no-console": "off" },
  },
  {
    // scripts/*.cjs are plain Node preload scripts loaded via NODE_OPTIONS before any
    // bundler/transpiler runs, so they must stay CommonJS — not part of the TS project.
    ignores: [
      // Both build outputs: `.next` for build/start, `.next-dev` for the dev server
      // (see distDir in next.config.ts). Neither is source.
      ".next/**",
      ".next-dev/**",
      "node_modules/**",
      "prisma/generated/**",
      "scripts/**/*.cjs",
      ".dev-postgres/**",
      ".dev-storage/**",
    ],
  },
];

export default eslintConfig;
