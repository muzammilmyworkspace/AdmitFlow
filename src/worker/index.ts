// Background worker entrypoint — full BullMQ job catalog is Phase 17 (docs/24-background-jobs.md).
// This placeholder exists so `npm run worker` is a valid command from Phase 1 onward;
// it will be replaced with real queue processors as each phase that needs async work lands
// (document processing in Phase 8, payment reconciliation in Phase 10, etc.).

import { logger } from "@/lib/logger";

logger.info("Worker process started (placeholder — no queues registered yet)");

process.on("SIGTERM", () => {
  logger.info("Worker received SIGTERM, shutting down");
  process.exit(0);
});
