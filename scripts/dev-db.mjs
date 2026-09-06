// Local-only real Postgres instance for development/testing in this environment.
// This is NOT part of the documented architecture (docs/39-deployment-architecture.md
// targets managed Postgres; the $0-phase profile in docs/54-decision-log.md D-11 uses
// Supabase's free tier) — it exists purely so auth/DB-dependent code can be exercised
// end-to-end on this machine without an external hosted database. Data lives in the
// gitignored .dev-postgres/ directory; safe to delete to reset.
//
// Shells out to the @embedded-postgres/windows-x64 binaries directly (pg_ctl/initdb)
// rather than using the embedded-postgres JS wrapper's start()/createDatabase(): the
// wrapper's default config left the server unreachable from Node on this machine
// (`localhost` resolving to ::1 while Postgres only listened on 127.0.0.1 — connections
// either hung or reset). Binding explicitly to 127.0.0.1 via `-h` here fixed it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = path.resolve(root, ".dev-postgres/data");
const logFile = path.resolve(root, ".dev-postgres/server.log");
const binDir = path.resolve(
  root,
  "node_modules/@embedded-postgres/windows-x64/native/bin",
);

const HOST = "127.0.0.1";
const PORT = 5433;
const USER = "admitflow";
const PASSWORD = "admitflow_dev_password";
const DB = "admitflow";

export const DEV_DATABASE_URL = `postgresql://${USER}:${PASSWORD}@${HOST}:${PORT}/${DB}`;

function run(bin, args) {
  return execFileSync(path.join(binDir, bin), args, { encoding: "utf8" });
}

function ensureInitialized() {
  if (existsSync(path.join(dataDir, "PG_VERSION"))) return;
  mkdirSync(dataDir, { recursive: true });
  const pwfile = path.resolve(root, ".dev-postgres/.pwfile");
  writeFileSync(pwfile, PASSWORD);
  run("initdb.exe", ["-D", dataDir, "-U", USER, "--pwfile", pwfile, "-A", "scram-sha-256"]);
}

function start() {
  ensureInitialized();
  // stdio must be "ignore", not the default "pipe": pg_ctl daemonizes the postgres
  // server, which inherits any stdio pipe we hand it and holds it open for its whole
  // lifetime — spawnSync then waits forever for a stream that never closes. Postgres
  // writes to `-l logFile` anyway, so we lose nothing by ignoring the streams here.
  const result = spawnSync(
    path.join(binDir, "pg_ctl.exe"),
    ["-D", dataDir, "-l", logFile, "-o", `-p ${PORT} -h ${HOST}`, "-w", "start"],
    { stdio: "ignore" },
  );
  if (result.status !== 0) {
    const tail = existsSync(logFile)
      ? readFileSync(logFile, "utf8").split("\n").slice(-20).join("\n")
      : "";
    if (/already running/i.test(tail)) {
      console.log(`Dev Postgres already running at ${DEV_DATABASE_URL}`);
      return;
    }
    console.error("pg_ctl start failed:\n" + tail);
    process.exit(1);
  }
  // The `admitflow` database itself is created by `prisma migrate dev`, which creates a
  // missing database automatically — no psql needed (this binary bundle ships only
  // initdb/pg_ctl/postgres anyway).
  console.log(`Dev Postgres ready at ${DEV_DATABASE_URL}`);
}

function stop() {
  if (!existsSync(dataDir)) {
    console.log("No dev Postgres data directory — nothing to stop.");
    return;
  }
  const result = spawnSync(path.join(binDir, "pg_ctl.exe"), ["-D", dataDir, "-m", "fast", "stop"], {
    encoding: "utf8",
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
}

const command = process.argv[2];
if (command === "start") start();
else if (command === "stop") stop();
else {
  console.error("Usage: node scripts/dev-db.mjs <start|stop>");
  process.exit(1);
}
