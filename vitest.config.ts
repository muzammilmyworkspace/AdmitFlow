import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Files run one at a time. In parallel, several workers each pay the cost of
    // transforming the Prisma client at once and time out fetching their own module
    // graph — reported as failed files with zero failed assertions, which is a
    // thoroughly misleading way to find out the machine is just busy. Sequential is
    // about 50s for the whole suite, which is a fair price for a truthful result.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
