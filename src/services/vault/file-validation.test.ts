import { describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  detectMimeType,
  scanForMalware,
  validateFileContent,
} from "./file-validation";

// docs/36-security-testing.md §"invalid file uploads". The whole point of this module is
// that the browser's claims are not evidence, so the tests attack it the same way.

const PDF = Buffer.from("%PDF-1.4\n...content...");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]); // MZ — a Windows executable

describe("detectMimeType", () => {
  it("identifies accepted formats from their magic bytes", () => {
    expect(detectMimeType(PDF)).toBe("application/pdf");
    expect(detectMimeType(PNG)).toBe("image/png");
    expect(detectMimeType(JPEG)).toBe("image/jpeg");
  });

  it("returns null for anything it does not recognise", () => {
    expect(detectMimeType(EXE)).toBeNull();
    expect(detectMimeType(Buffer.from("just some text"))).toBeNull();
  });
});

describe("validateFileContent", () => {
  it("accepts a genuine PDF declared as a PDF", () => {
    expect(validateFileContent(PDF, "application/pdf", "transcript.pdf").ok).toBe(true);
  });

  it("rejects an executable renamed to .pdf — the core attack this exists to stop", () => {
    const result = validateFileContent(EXE, "application/pdf", "cv.pdf");
    expect(result.ok).toBe(false);
    expect(result.detectedMime).toBeNull();
  });

  it("rejects a real PNG declared as a PDF", () => {
    const result = validateFileContent(PNG, "application/pdf", "scan.pdf");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/doesn't match/i);
  });

  it("rejects a real PDF wearing the wrong extension", () => {
    const result = validateFileContent(PDF, "application/pdf", "passport.png");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/extension/i);
  });

  it("accepts both .jpg and .jpeg for a JPEG", () => {
    expect(validateFileContent(JPEG, "image/jpeg", "photo.jpg").ok).toBe(true);
    expect(validateFileContent(JPEG, "image/jpeg", "photo.jpeg").ok).toBe(true);
  });

  it("rejects an empty file", () => {
    expect(validateFileContent(Buffer.alloc(0), "application/pdf", "x.pdf").ok).toBe(false);
  });

  it("rejects a file over the size limit", () => {
    const oversized = Buffer.concat([PDF, Buffer.alloc(MAX_FILE_BYTES)]);
    const result = validateFileContent(oversized, "application/pdf", "big.pdf");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/5MB or smaller/);
  });

  it("is not fooled by an extension in the middle of the filename", () => {
    expect(validateFileContent(EXE, "application/pdf", "invoice.pdf.exe").ok).toBe(false);
  });
});

describe("scanForMalware", () => {
  it("flags the EICAR test signature", async () => {
    const eicar = Buffer.from(
      "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
    );
    expect(await scanForMalware(eicar)).toBe("INFECTED");
  });

  it("reports NOT_SCANNED rather than CLEAN when no vendor is wired up", async () => {
    // Reporting "clean" without a real scan would be a false assurance — the honest
    // answer is that nothing checked it (docs/55 B-3).
    expect(await scanForMalware(PDF)).toBe("NOT_SCANNED");
  });
});
