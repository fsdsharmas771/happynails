import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type UploadKind = "image" | "video";

/** Where uploaded media lives. Local disk in development; S3 or Cloudinary can implement this in production. */
export interface UploadProvider {
  save(file: { buffer: Buffer; ext: string; contentType: string }): Promise<{ url: string }>;
}

export const UPLOAD_LIMITS: Record<UploadKind, number> = {
  image: 5 * 1024 * 1024,
  video: 50 * 1024 * 1024,
};

interface Detected {
  kind: UploadKind;
  ext: string;
  contentType: string;
}

/**
 * Identifies a file from its first bytes, ignoring the name and the browser's claimed type,
 * so a renamed script or HTML file cannot be stored as an "image".
 */
export function sniff(buf: Buffer): Detected | null {
  const ascii = (start: number, end: number) => buf.subarray(start, end).toString("latin1");
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { kind: "image", ext: "jpg", contentType: "image/jpeg" };
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: "image", ext: "png", contentType: "image/png" };
  }
  if (buf.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { kind: "image", ext: "webp", contentType: "image/webp" };
  }
  if (buf.length >= 12 && ascii(4, 8) === "ftyp") {
    return { kind: "video", ext: "mp4", contentType: "video/mp4" };
  }
  if (buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { kind: "video", ext: "webm", contentType: "video/webm" };
  }
  return null;
}

/** Stores files under a directory served at /uploads, with random names. */
export function createLocalUploadProvider(dir: string, publicBase = "/uploads"): UploadProvider {
  return {
    async save({ buffer, ext }) {
      await mkdir(dir, { recursive: true });
      const name = `${randomBytes(16).toString("hex")}.${ext}`;
      await writeFile(path.join(dir, name), buffer, { flag: "wx" });
      return { url: `${publicBase}/${name}` };
    },
  };
}
