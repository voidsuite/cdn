import path from "node:path"
import { randomBytes } from "node:crypto"
import config from "../../config.js"
import type { StorageDriver } from "./types.js"
import { LocalDriver } from "./local.js"
import { S3Driver } from "./s3.js"
import { BunnyDriver } from "./bunny.js"

export type { StorageDriver, StorageZone, PutOptions } from "./types.js"

export function createStorage(): StorageDriver {
  switch (config.storage.driver) {
    case "s3":
      return new S3Driver()
    case "bunny":
      return new BunnyDriver()
    default:
      return new LocalDriver()
  }
}

export const storage = createStorage()

export function safeExtension(filename: string): string {
  const ext = path.extname(filename || "").toLowerCase().replace(/[^a-z0-9.]/g, "")
  if (!ext || ext.length > 12) return ".bin"
  return ext
}

export function sanitizeName(filename: string): string {
  const base = (filename || "untitled").split(/[/\\]/).pop() || "untitled"
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 240) || "untitled"
}

/**
 * Readable, collision-free object name: `[12 hex chars]_original-name.ext`.
 * Uploaded names never map directly to a predictable public URL, while the
 * original name stays visible in the link. 48 random bits keep collisions
 * negligible at this app's scale without lengthening the URL.
 */
export function objectName(filename: string): string {
  const base = sanitizeName(filename)
  const dot = base.lastIndexOf(".")
  const hasExt = dot > 0 && dot < base.length - 1
  const stem = hasExt ? base.slice(0, dot) : base
  const ext = hasExt ? safeExtension(base) : ""

  const clean = stem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80)

  const random = randomBytes(6).toString("hex")
  return `${random}_${clean || "file"}${ext}`
}

export function makeKey(filename: string): string {
  const prefix = config.storage.prefix ? `${config.storage.prefix}/` : ""
  // Short and unguessable: a random prefix in front of the readable name.
  return `${prefix}${objectName(filename)}`
}

export function blockedMimeList(): string[] {
  return config.defaults.blockedMimeTypes
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export function isBlockedMime(mime: string): boolean {
  const value = (mime || "").toLowerCase()
  return blockedMimeList().some((blocked) => value === blocked || value.startsWith(`${blocked};`))
}

export function inlineMime(mime: string): boolean {
  const value = (mime || "").toLowerCase()
  return (
    value.startsWith("image/") ||
    value.startsWith("video/") ||
    value.startsWith("audio/") ||
    value === "application/pdf" ||
    value.startsWith("text/plain") ||
    value.startsWith("text/markdown") ||
    value.startsWith("application/json")
  )
}

export function contentDisposition(filename: string, mime: string, forceDownload = false): string {
  const safe = filename.replace(/["\\\r\n]/g, "_")
  const kind = forceDownload || !inlineMime(mime) ? "attachment" : "inline"
  return `${kind}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export function uploadModeForDriver(): "presigned" | "proxy" {
  if (config.storage.uploadMode === "presigned") return "presigned"
  if (config.storage.uploadMode === "proxy") return "proxy"
  return storage.supportsPresign ? "presigned" : "proxy"
}
