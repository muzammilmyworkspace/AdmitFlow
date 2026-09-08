// Background worker entrypoint.
//
// The $0-infrastructure profile (docs/54-decision-log.md D-11) runs the periodic work as
// scheduled batches rather than from a resident queue consumer: an external scheduler
// calls POST /api/v1/internal/cron, which invokes exactly the function below.
//
// This command exists so the same sweeps can be run by hand -- against a local database,
// or from a one-off container -- without going through HTTP:
//
//     npm run worker
//
// When a real BullMQ topology is warranted, the queue processors register here and call
// the same services. Nothing in those services knows which of the three drove it.

import { logger } from "@/lib/logger";
import { runScheduledSweeps } from "@/services/scheduled-jobs";

async function main() {
  logger.info("Running scheduled sweeps", { service: "worker", operation: "main" });
  const result = await runScheduledSweeps();
  logger.info("Scheduled sweeps completed", { service: "worker", operation: "main", ...result });
  // A non-zero exit tells a cron runner that something needs looking at, without
  // pretending the whole run failed.
  process.exit(result.errors.length > 0 ? 1 : 0);
}

process.on("SIGTERM", () => {
  logger.info("Worker received SIGTERM, shutting down");
  process.exit(0);
});

main().catch((error) => {
  logger.error("Worker failed", {
    service: "worker",
    operation: "main",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
