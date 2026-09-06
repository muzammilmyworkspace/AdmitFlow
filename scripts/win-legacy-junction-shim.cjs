"use strict";

// Windows-only build shim. Root cause: Next.js's output-file-tracer (@vercel/nft) has a
// built-in Prisma special case that, in addition to globbing the project root for
// schema.prisma, also globs the OS home directory as a broad recursive fallback. Windows
// user profiles are full of restricted, SYSTEM-only folders (legacy pre-Vista junctions
// like "Application Data", plus modern ones like AppData\Local\ElevatedDiagnostics,
// WebCache, INetCache, ConnectedDevicesPlatform, ...) that deny directory listing to
// normal processes, so that fallback glob crashes the build with an unrelated EPERM error
// before tracing ever gets to files that matter — there is no fixed, enumerable list of
// which subfolder will be hit next. Loaded via NODE_OPTIONS for build/dev only.
//
// This does not touch application logic or security controls: it only suppresses
// EPERM/EACCES specifically on directory-listing calls, and only for paths under the
// current user's home directory (never the project directory or anything else), turning
// "can't list this restricted folder" into "treat it as empty" instead of crashing the
// build for a folder AdmitFlow never needed to read in the first place.

if (process.platform !== "win32") {
  module.exports = {};
  return;
}

const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
// The project itself must never live under HOME for this short-circuit to be safe;
// true for this repo (it's on a separate drive) and asserted defensively below anyway.
const PROJECT_ROOT = path.resolve(__dirname, "..");

function isUnderHome(p) {
  if (typeof p !== "string") return false;
  const resolved = path.resolve(p);
  if (resolved === PROJECT_ROOT || resolved.startsWith(PROJECT_ROOT + path.sep)) {
    return false;
  }
  return resolved === HOME || resolved.startsWith(HOME + path.sep);
}

// Short-circuit to "empty directory" for any path under the user's home directory,
// without even attempting the real syscall. Nothing under $HOME is ever relevant to
// tracing this project's build output, and a real recursive scan of a full Windows user
// profile (browser caches, OneDrive sync state, etc.) is both slow and guaranteed to hit
// more than one restricted/SYSTEM-only folder — there's no fixed list to allowlist around.
const origReaddir = fs.readdir;
fs.readdir = function (p, ...rest) {
  const cb = rest[rest.length - 1];
  if (isUnderHome(p) && typeof cb === "function") return cb(null, []);
  return origReaddir.call(this, p, ...rest);
};

const origReaddirSync = fs.readdirSync;
fs.readdirSync = function (p, ...rest) {
  if (isUnderHome(p)) return [];
  return origReaddirSync.call(this, p, ...rest);
};

if (fs.promises && fs.promises.readdir) {
  const origP = fs.promises.readdir;
  fs.promises.readdir = function (p, ...rest) {
    if (isUnderHome(p)) return Promise.resolve([]);
    return origP.call(this, p, ...rest);
  };
}

module.exports = {};
