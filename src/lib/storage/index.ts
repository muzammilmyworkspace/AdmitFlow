import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/env";

// Object storage — docs/15-document-vault-security.md, docs/32-file-storage-strategy.md.
//
// AWS S3 (private buckets, signed URLs only) is the documented production store. This
// module puts both drivers behind one interface so the vault's security semantics are
// identical either way: nothing is ever publicly readable, every access needs a
// short-lived scoped signed URL, and object keys are non-guessable and never derived
// from the user-supplied filename.
//
// The local driver exists because this environment has no AWS credentials. It is not a
// mock that pretends to store things — it writes real bytes to a directory outside the
// web root and issues real HMAC-signed, expiring URLs that the vault download route
// verifies. It is selected only when S3 is not configured, and it refuses to run in
// production so a missing credential can never silently downgrade production storage.

export interface StorageDriver {
  readonly name: string;
  /** Signs a short-lived URL the browser PUTs the file directly to. */
  createUploadUrl(key: string, contentType: string, ttlSeconds: number): Promise<string>;
  /** Signs a short-lived URL scoped to exactly one object. */
  createDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  getObject(key: string): Promise<Buffer>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  objectSize(key: string): Promise<number | null>;
}

// ---------------------------------------------------------------- local driver ---

const LOCAL_ROOT = path.resolve(process.cwd(), ".dev-storage");

function signLocal(key: string, expiresAt: number, mode: "put" | "get"): string {
  return createHmac("sha256", getEnv().SESSION_SECRET)
    .update(`${mode}:${key}:${expiresAt}`)
    .digest("hex");
}

/** Verifies a local signed URL. Exported for the local upload/download routes. */
export function verifyLocalSignature(
  key: string,
  expiresAt: number,
  mode: "put" | "get",
  signature: string,
): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const expected = signLocal(key, expiresAt, mode);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function localPathFor(key: string): string {
  // Defence in depth against traversal: the resolved path must stay under LOCAL_ROOT
  // even though keys are server-generated, never user-supplied.
  const resolved = path.resolve(LOCAL_ROOT, key);
  if (resolved !== LOCAL_ROOT && !resolved.startsWith(LOCAL_ROOT + path.sep)) {
    throw new Error("Refusing to resolve a storage key outside the storage root.");
  }
  return resolved;
}

class LocalStorageDriver implements StorageDriver {
  readonly name = "local";

  private signedUrl(key: string, ttlSeconds: number, mode: "put" | "get"): string {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const signature = signLocal(key, expiresAt, mode);
    const params = new URLSearchParams({ key, expires: String(expiresAt), sig: signature });
    return `${getEnv().NEXT_PUBLIC_APP_URL}/api/v1/vault/local-object?${params.toString()}`;
  }

  async createUploadUrl(key: string, _contentType: string, ttlSeconds: number) {
    return this.signedUrl(key, ttlSeconds, "put");
  }

  async createDownloadUrl(key: string, ttlSeconds: number) {
    return this.signedUrl(key, ttlSeconds, "get");
  }

  async getObject(key: string) {
    return readFile(localPathFor(key));
  }

  async putObject(key: string, body: Buffer) {
    const target = localPathFor(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  async deleteObject(key: string) {
    try {
      await unlink(localPathFor(key));
    } catch {
      // Already gone — deletion is idempotent.
    }
  }

  async objectSize(key: string) {
    try {
      return (await stat(localPathFor(key))).size;
    } catch {
      return null;
    }
  }
}

// ------------------------------------------------------------------- S3 driver ---

class S3StorageDriver implements StorageDriver {
  readonly name = "s3";

  private async client() {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const env = getEnv();
    return new S3Client({
      region: env.AWS_REGION,
      credentials:
        env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.AWS_ACCESS_KEY_ID,
              secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  async createUploadUrl(key: string, contentType: string, ttlSeconds: number) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const command = new PutObjectCommand({
      Bucket: getEnv().S3_BUCKET,
      Key: key,
      ContentType: contentType,
      // Encryption at rest — docs/15-document-vault-security.md §6.
      ServerSideEncryption: "AES256",
    });
    return getSignedUrl(await this.client(), command, { expiresIn: ttlSeconds });
  }

  async createDownloadUrl(key: string, ttlSeconds: number) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const command = new GetObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: key });
    return getSignedUrl(await this.client(), command, { expiresIn: ttlSeconds });
  }

  async getObject(key: string) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const result = await (await this.client()).send(
      new GetObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: key }),
    );
    return Buffer.from(await result.Body!.transformToByteArray());
  }

  async putObject(key: string, body: Buffer, contentType: string) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.client()).send(
      new PutObjectCommand({
        Bucket: getEnv().S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: "AES256",
      }),
    );
  }

  async deleteObject(key: string) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.client()).send(
      new DeleteObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: key }),
    );
  }

  async objectSize(key: string) {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      const result = await (await this.client()).send(
        new HeadObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: key }),
      );
      return result.ContentLength ?? null;
    } catch {
      return null;
    }
  }
}

let driver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (driver) return driver;
  const env = getEnv();
  const s3Configured = !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.S3_BUCKET);

  if (!s3Configured && env.APP_ENV === "production") {
    throw new Error(
      "S3 is not configured. Production document storage must be S3 (docs/54-decision-log.md D-1); the local driver is development-only.",
    );
  }

  driver = s3Configured ? new S3StorageDriver() : new LocalStorageDriver();
  return driver;
}
