/**
 * /api/files — user-facing file management.
 *
 * Uploads use a two-step flow: create an intent, then either PUT the bytes to
 * the gateway proxy (`mode: "proxy"`, Bunny native API / local) or upload
 * directly to S3 with a presigned URL and call `/complete` afterwards.
 */

import { Hono } from "hono"
import config from "../config.js"
import { getAuth, authRequired, authOptional, requireScope, clientIp } from "../middleware/auth.js"
import { getSettings } from "../db/settings.js"
import { canStore, effectiveMaxUpload, quotaState } from "../lib/quota.js"
import { resolveRetention } from "../lib/retention.js"
import {
  createPendingFile,
  deleteFileRow,
  getFileById,
  getFileCount,
  getFileForUser,
  getExpiringCount,
  getReservedUsage,
  getUsage,
  listFiles,
  markFileReady,
  updateFile,
  type FileRow,
} from "../db/files.js"
import { createIntent, deleteIntentByFile, getIntentByFile } from "../db/intents.js"
import {
  isBlockedMime,
  makeKey,
  sanitizeName,
  storage,
  uploadModeForDriver,
  type StorageZone,
} from "../lib/storage/index.js"
import { uuid } from "../lib/ids.js"
import { fileDto, fileUrl } from "../lib/dto.js"
import type { Visibility } from "../db/files.js"
import { audit } from "../db/audit.js"
import { serveFile } from "../lib/serve.js"
import type { StoredUser } from "../db/users.js"

// Large files can take a while on slow links; an intent should outlive the
// upload it was created for.
const INTENT_TTL_MS = 60 * 60 * 1000

const files = new Hono()

function normalizeMime(value: unknown): string {
  const raw = typeof value === "string" ? value : ""
  const base = raw.split(";")[0]?.trim().toLowerCase() || "application/octet-stream"
  return base.slice(0, 160) || "application/octet-stream"
}

function visibilityOf(value: unknown, fallback: Visibility): Visibility {
  // "public" was retired; old clients booking it fall back to link-only.
  if (value === "private") return "private"
  if (value === "unlisted" || value === "public") return "unlisted"
  return fallback
}

function zoneFor(visibility: Visibility): StorageZone {
  if (storage.name !== "bunny") return "default"
  if (visibility === "private") return config.storage.bunny.privateZone ? "private" : "default"
  return config.storage.bunny.publicZone ? "public" : "default"
}

function expiryFor(hours: number | null): number | null {
  return hours === null ? null : Date.now() + hours * 60 * 60 * 1000
}

function clientMeta(c: Parameters<typeof clientIp>[0]) {
  return { ip: clientIp(c), ua: c.req.header("user-agent") || null }
}

async function discardFile(file: FileRow): Promise<void> {
  await storage.delete(file.key, file.storage_zone as StorageZone).catch(() => {})
  deleteIntentByFile(file.id)
  deleteFileRow(file.id)
}

function canStoreActual(user: StoredUser, file: FileRow, size: number) {
  const usedWithoutThisFile = Math.max(0, getReservedUsage(user.id) - file.size)
  return canStore(user, getSettings(), usedWithoutThisFile, size)
}

// GET /api/files — paginated list scoped to the signed-in user.
files.get("/", authRequired, requireScope("files:read"), async (c) => {
  const principal = getAuth(c)
  const page = Number(c.req.query("page") || 1)
  const limit = Number(c.req.query("limit") || 40)
  const result = listFiles({
    userId: principal.user.id,
    search: c.req.query("search")?.trim() || undefined,
    type: c.req.query("type") || undefined,
    sort: c.req.query("sort") || undefined,
    visibility: c.req.query("visibility") || undefined,
    expiring: c.req.query("expiring") === "1" || c.req.query("expiring") === "true",
    page: Number.isFinite(page) ? page : 1,
    limit: Number.isFinite(limit) ? limit : 40,
  })
  const items = await Promise.all(result.files.map((file) => fileDto(file)))
  return c.json({ files: items, total: result.total, page: result.page, limit: result.limit })
})

// GET /api/files/stats — quota + counters for the dashboard.
files.get("/stats", authRequired, requireScope("stats:read"), async (c) => {
  const principal = getAuth(c)
  const user = principal.user
  const settings = getSettings()
  const used = getUsage(user.id)
  return c.json({
    storage: quotaState(user, settings, used),
    files: getFileCount(user.id),
    expiringSoon: getExpiringCount(user.id),
    maxUploadBytes: effectiveMaxUpload(user, settings),
    defaults: {
      visibility: settings.defaultVisibility,
      largeFileThresholdBytes: settings.largeFileThresholdBytes,
      largeFileRetentionHours: settings.largeFileRetentionHours,
      defaultRetentionHours: settings.defaultRetentionHours,
    },
  })
})

// POST /api/files/intents — reserve quota and prepare an upload target.
files.post("/intents", authRequired, requireScope("files:upload"), async (c) => {
  const principal = getAuth(c)
  const user = principal.user
  const settings = getSettings()
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: "Invalid request" }, 400)

  const name = sanitizeName(String(body.name || ""))
  const mime = normalizeMime(body.mime)
  const size = Math.trunc(Number(body.size))

  if (!name || name === "untitled") return c.json({ error: "A file name is required" }, 400)
  if (!Number.isFinite(size) || size <= 0) return c.json({ error: "File size is required" }, 400)
  if (isBlockedMime(mime)) {
    return c.json({ error: "This file type is not allowed for security reasons." }, 415)
  }

  const quota = canStore(user, settings, getReservedUsage(user.id), size)
  if (!quota.ok) return c.json({ error: quota.error }, quota.error.includes("quota") ? 413 : 413)

  const visibility = visibilityOf(body.visibility, settings.defaultVisibility)
  const retention = resolveRetention({ size, user, settings })
  const key = makeKey(name)
  const fileId = uuid()
  const zone = zoneFor(visibility)

  const file = createPendingFile({
    id: fileId,
    userId: user.id,
    key,
    name,
    mime,
    size,
    visibility,
    storageDriver: storage.name,
    storageZone: zone,
    expiresAt: retention.expiresAt,
    retentionHours: retention.hours,
    retentionSource: retention.source,
  })

  const mode = uploadModeForDriver()
  let presigned = null
  if (mode === "presigned") {
    presigned = await storage
      .createUploadUrl(key, {
        contentType: mime,
        contentLength: size,
        cacheControl: visibility === "private" ? "private, no-store" : "public, max-age=31536000, immutable",
      })
      .catch(() => null)
  }

  const intentMode = presigned ? "presigned" : "proxy"
  const expiresAt = Date.now() + INTENT_TTL_MS
  const intentId = uuid()
  createIntent({
    id: intentId,
    file_id: file.id,
    user_id: user.id,
    key,
    size,
    mime,
    mode: intentMode,
    storage_zone: zone,
    expires_at: expiresAt,
  })

  const { ip, ua } = clientMeta(c)
  audit({
    actorId: user.id,
    actorEmail: user.email,
    action: "file.intent",
    targetType: "file",
    targetId: file.id,
    meta: { name, size, mime, visibility, mode: intentMode },
    ip,
    ua,
  })

  return c.json({
    file: await fileDto(file),
    intent: {
      id: intentId,
      mode: intentMode,
      expiresAt,
      upload: presigned
        ? {
            method: "PUT",
            url: presigned.url,
            headers: presigned.headers,
            expiresIn: presigned.expiresIn,
          }
        : {
            method: "PUT",
            url: `/api/files/${file.id}/content`,
            headers: { "Content-Type": mime },
          },
    },
  })
})

// PUT /api/files/:id/content — streaming proxy upload (Bunny native / local).
files.put("/:id/content", authRequired, requireScope("files:upload"), async (c) => {
  const principal = getAuth(c)
  const user = principal.user
  const file = getFileForUser(c.req.param("id"), user.id)
  if (!file) return c.json({ error: "Upload not found" }, 404)
  if (file.status !== "pending") return c.json({ error: "This upload is already complete" }, 409)

  const intent = getIntentByFile(file.id)
  if (!intent || intent.mode !== "proxy") return c.json({ error: "Invalid upload intent" }, 409)
  if (Date.now() > intent.expires_at) {
    await discardFile(file)
    return c.json({ error: "Upload intent expired" }, 410)
  }

  const body = c.req.raw.body
  if (!body) return c.json({ error: "Missing request body" }, 400)

  const declared = Number(c.req.header("content-length") || 0)
  if (Number.isFinite(declared) && declared > 0) {
    const check = canStoreActual(user, file, declared)
    if (!check.ok) {
      await discardFile(file)
      return c.json({ error: check.error }, 413)
    }
  }

  const zone = file.storage_zone as StorageZone
  try {
    const uploaded = await storage.put(file.key, body, {
      contentType: file.mime,
      contentLength: declared > 0 ? declared : undefined,
      cacheControl:
        file.visibility === "private" ? "private, no-store" : "public, max-age=31536000, immutable",
      contentDisposition: `inline; filename="${file.name.replace(/["\\\r\n]/g, "_")}"`,
      zone,
    })

    const head = await storage.head(file.key, zone)
    const actual = head?.size ?? (declared > 0 ? declared : 0)
    if (!actual) throw new Error("Storage did not confirm the upload")

    const check = canStoreActual(user, file, actual)
    if (!check.ok) {
      await discardFile(file)
      return c.json({ error: check.error }, 413)
    }

    markFileReady(file.id, actual, uploaded.etag ?? head?.etag ?? null)
    const expiresAt = expiryFor(file.retention_hours)
    const ready = updateFile(file.id, { expiresAt }) as FileRow
    deleteIntentByFile(file.id)

    const { ip, ua } = clientMeta(c)
    audit({
      actorId: user.id,
      actorEmail: user.email,
      action: "file.upload",
      targetType: "file",
      targetId: file.id,
      meta: { name: file.name, size: actual, mime: file.mime, visibility: file.visibility },
      ip,
      ua,
    })

    return c.json({ file: await fileDto(ready) })
  } catch (err) {
    await discardFile(file)
    return c.json({ error: (err as Error).message || "Upload failed" }, 502)
  }
})

// POST /api/files/:id/complete — verify a direct (presigned) upload.
files.post("/:id/complete", authRequired, requireScope("files:upload"), async (c) => {
  const principal = getAuth(c)
  const user = principal.user
  const file = getFileForUser(c.req.param("id"), user.id)
  if (!file) return c.json({ error: "Upload not found" }, 404)
  if (file.status !== "pending") return c.json({ file: await fileDto(file) })

  const intent = getIntentByFile(file.id)
  if (!intent) return c.json({ error: "Invalid upload intent" }, 409)
  if (Date.now() > intent.expires_at) {
    await discardFile(file)
    return c.json({ error: "Upload intent expired" }, 410)
  }

  const zone = file.storage_zone as StorageZone
  const head = await storage.head(file.key, zone)
  if (!head || !head.size) {
    return c.json({ error: "Upload has not reached storage yet" }, 409)
  }

  const check = canStoreActual(user, file, head.size)
  if (!check.ok) {
    await discardFile(file)
    return c.json({ error: check.error }, 413)
  }

  markFileReady(file.id, head.size, head.etag ?? null)
  const expiresAt = expiryFor(file.retention_hours)
  const ready = updateFile(file.id, { expiresAt }) as FileRow
  deleteIntentByFile(file.id)

  const { ip, ua } = clientMeta(c)
  audit({
    actorId: user.id,
    actorEmail: user.email,
    action: "file.upload",
    targetType: "file",
    targetId: file.id,
    meta: { name: file.name, size: head.size, mime: file.mime, visibility: file.visibility },
    ip,
    ua,
  })

  return c.json({ file: await fileDto(ready) })
})

// PATCH /api/files/:id — rename or change link visibility.
files.patch("/:id", authRequired, requireScope("files:share"), async (c) => {
  const principal = getAuth(c)
  const user = principal.user
  const file = getFileForUser(c.req.param("id"), user.id)
  if (!file) return c.json({ error: "File not found" }, 404)
  if (file.status !== "ready") return c.json({ error: "File is not ready" }, 409)

  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: "Invalid request" }, 400)

  const patch: Parameters<typeof updateFile>[1] = {}
  if (body.name !== undefined) {
    const name = sanitizeName(String(body.name))
    if (!name) return c.json({ error: "A file name is required" }, 400)
    patch.name = name
  }
  if (body.visibility !== undefined) {
    if (body.visibility !== "unlisted" && body.visibility !== "private") {
      return c.json({ error: "Invalid visibility" }, 400)
    }
    patch.visibility = body.visibility
  }
  if (!patch.name && !patch.visibility) return c.json({ error: "Nothing to update" }, 400)

  const updated = updateFile(file.id, patch)
  if (!updated) return c.json({ error: "File not found" }, 404)

  const { ip, ua } = clientMeta(c)
  audit({
    actorId: user.id,
    actorEmail: user.email,
    action: "file.update",
    targetType: "file",
    targetId: file.id,
    meta: patch,
    ip,
    ua,
  })
  return c.json({ file: await fileDto(updated) })
})

// DELETE /api/files/:id — remove the object and free quota.
files.delete("/:id", authRequired, requireScope("files:delete"), async (c) => {
  const principal = getAuth(c)
  const user = principal.user
  const file = getFileForUser(c.req.param("id"), user.id)
  if (!file) return c.json({ error: "File not found" }, 404)

  await storage.delete(file.key, file.storage_zone as StorageZone).catch(() => {})
  deleteIntentByFile(file.id)
  deleteFileRow(file.id)

  const { ip, ua } = clientMeta(c)
  audit({
    actorId: user.id,
    actorEmail: user.email,
    action: "file.delete",
    targetType: "file",
    targetId: file.id,
    meta: { name: file.name, size: file.size },
    ip,
    ua,
  })
  return c.json({ ok: true })
})

// GET /api/files/:id/url — fresh link (private links point at the gateway).
files.get("/:id/url", authRequired, requireScope("files:read"), async (c) => {
  const principal = getAuth(c)
  const user = principal.user
  const file = getFileForUser(c.req.param("id"), user.id)
  if (!file) return c.json({ error: "File not found" }, 404)
  return c.json({ url: await fileUrl(file), downloadUrl: `/api/files/${file.id}/download?download=1` })
})

// GET /api/files/:id/download — inline preview / forced download.
// Public + unlisted files are reachable without a session; private files are
// owner (or admin) only.
files.get("/:id/download", authOptional, async (c) => {
  const file = getFileById(c.req.param("id"))
  if (!file || file.status !== "ready") return c.json({ error: "File not found" }, 404)
  if (file.expires_at !== null && file.expires_at <= Date.now()) {
    return c.json({ error: "File has expired" }, 410)
  }

  if (file.visibility === "private") {
    const principal = getAuth(c)
    if (!principal) return c.json({ error: "Not authenticated" }, 401)
    if (principal.user.id !== file.user_id && principal.user.is_admin !== 1) {
      return c.json({ error: "File not found" }, 404)
    }
  }

  const download = c.req.query("download") === "1" || c.req.query("download") === "true"
  return serveFile(c, file, { download })
})

export default files
