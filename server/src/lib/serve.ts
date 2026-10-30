/**
 * Shared streaming response for gateway-served files (local storage, private
 * objects, or Bunny without a public pull zone).
 */

import type { Context } from "hono"
import type { FileRow } from "../db/files.js"
import { recordDownload } from "../db/files.js"
import { contentDisposition, inlineMime } from "./storage/index.js"
import { storage, type StorageZone } from "./storage/index.js"

export async function serveFile(
  c: Context,
  file: FileRow,
  options: { download?: boolean; cacheSeconds?: number } = {}
): Promise<Response> {
  const zone = file.storage_zone as StorageZone
  const result = await storage.getStream(file.key, zone)
  if (!result) return c.json({ error: "File is no longer available" }, 404)

  const forceDownload = options.download === true || !inlineMime(file.mime)
  const headers = new Headers({
    "Content-Type": file.mime || "application/octet-stream",
    "Content-Disposition": contentDisposition(file.name, file.mime, forceDownload),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control":
      file.visibility === "private"
        ? "private, no-store"
        : `public, max-age=${Math.max(0, options.cacheSeconds ?? 3600)}`,
  })
  if (result.contentLength !== undefined) headers.set("Content-Length", String(result.contentLength))
  if (!inlineMime(file.mime)) headers.set("Content-Security-Policy", "sandbox")
  if (c.req.method !== "HEAD") recordDownload(file.id)

  return new Response(result.stream, { status: 200, headers })
}
