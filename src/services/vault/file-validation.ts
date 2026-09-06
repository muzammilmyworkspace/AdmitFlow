// File validation — docs/15-document-vault-security.md §4, docs/16 of the build brief.
//
// The browser-supplied filename, extension and Content-Type are all attacker-controlled
// and are never trusted for a security decision. What the file actually IS is determined
// server-side from its magic bytes.

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB default per the build brief §19

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

interface MagicSignature {
  mime: AllowedMimeType;
  offset: number;
  bytes: number[];
}

// Minimal, unambiguous signatures for the formats we accept.
const SIGNATURES: MagicSignature[] = [
  { mime: "application/pdf", offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: "image/jpeg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

/** Returns the real type from the file's bytes, or null when it isn't one we accept. */
export function detectMimeType(buffer: Buffer): AllowedMimeType | null {
  for (const sig of SIGNATURES) {
    const slice = buffer.subarray(sig.offset, sig.offset + sig.bytes.length);
    if (slice.length === sig.bytes.length && sig.bytes.every((b, i) => slice[i] === b)) {
      return sig.mime;
    }
  }
  return null;
}

export interface FileValidationResult {
  ok: boolean;
  detectedMime: AllowedMimeType | null;
  reason?: string;
}

/**
 * Validates an uploaded file's real content.
 *
 * Rejects on: size, unrecognised magic bytes, and — importantly — a mismatch between what
 * the client claimed and what the bytes actually are. A .pdf that is really an executable
 * is the classic vector this exists to stop.
 */
export function validateFileContent(
  buffer: Buffer,
  claimedMime: string,
  claimedFilename: string,
): FileValidationResult {
  if (buffer.length === 0) {
    return { ok: false, detectedMime: null, reason: "The file is empty." };
  }
  if (buffer.length > MAX_FILE_BYTES) {
    return {
      ok: false,
      detectedMime: null,
      reason: `Files must be ${MAX_FILE_BYTES / (1024 * 1024)}MB or smaller.`,
    };
  }

  const detected = detectMimeType(buffer);
  if (!detected) {
    return {
      ok: false,
      detectedMime: null,
      reason: "That file type isn't accepted. Upload a PDF, JPEG, or PNG.",
    };
  }
  if (detected !== claimedMime) {
    return {
      ok: false,
      detectedMime: detected,
      reason: `The file's actual type (${detected}) doesn't match what was declared (${claimedMime}).`,
    };
  }

  const extension = claimedFilename.split(".").pop()?.toLowerCase() ?? "";
  const allowedExtensions: Record<AllowedMimeType, string[]> = {
    "application/pdf": ["pdf"],
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
  };
  if (!allowedExtensions[detected].includes(extension)) {
    return {
      ok: false,
      detectedMime: detected,
      reason: `A ${detected} file should not have a .${extension} extension.`,
    };
  }

  return { ok: true, detectedMime: detected };
}

/**
 * Malware scan hook — docs/15-document-vault-security.md §5.
 *
 * No scanning vendor has been selected yet (docs/55 B-3), so this is the integration
 * point rather than an implementation. It fails CLOSED for the one signature it can
 * check without a vendor (the EICAR test string) and otherwise returns "not scanned",
 * which the caller records honestly rather than reporting as clean.
 */
export type ScanVerdict = "CLEAN" | "INFECTED" | "NOT_SCANNED";

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export async function scanForMalware(buffer: Buffer): Promise<ScanVerdict> {
  if (buffer.subarray(0, 1024).toString("latin1").includes(EICAR)) return "INFECTED";
  return "NOT_SCANNED";
}
