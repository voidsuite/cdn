/**
 * /api/admin — elevated admin API.
 *
 * The panel is locked behind a short-lived, HttpOnly cookie scoped to
 * `/api/admin`. Unlocking re-checks the live VoidAuth `role` claim through
 * userinfo, re-validating the role on every unlock (and after token refresh).
 */

import { Hono } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import config from "../config.js"
import { authRequired, getAuth, clientIp } from "../middleware/auth.js"
import { adminRequired, adminSessionActive, verifyVoidAuthAdmin } from "../middleware/admin.js"
import {
  adminCookieOptions,
  createAdminSession,
  deleteAdminSession,
  getAdminSession,
} from "../db/admin-sessions.js"
import { refreshTokens } from "../lib/oauth.js"
import { updateSessionTokens } from "../db/sessions.js"
import {
  countAdmins,
  countUsers,
  getUserById,
  listUsers,
  updateUserLimits,
} from "../db/users.js"
import {
  deleteFileRow,
  getExpiringCount,
  getExpiringGlobalCount,
  getFileById,
  getFileCount,
  getGlobalUsage,
  getPendingCount,
  getTotalDownloads,
  getUsage,
  listFiles,
  updateFile,
} from "../db/files.js"
import { deleteIntentByFile } from "../db/intents.js"
import { defaultSettings, getSettings, updateSettings, type Settings } from "../db/settings.js"
import { listAudit, audit } from "../db/audit.js"
import { fileDto, userDto } from "../lib/dto.js"
import { quotaState, effectiveMaxUpload, effectiveQuota } from "../lib/quota.js"
import { sanitizeName, storage, type StorageZone } from "../lib/storage/index.js"
import { retentionLabel } from "../lib/retention.js"

const admin = new Hono()

// Authentication applies to every admin route; the unlock gate below is the
// only part that does not require the elevated admin cookie.
admin.use("*", authRequired)

function meta(c: Parameters<typeof clientIp>[0]) {
  return { ip: clientIp(c), ua: c.req.header("user-agent") || null }
}

function normalizeUnlimited(value: number, min: number): number | null {
  if (value <= 0) return -1
  if (value < min) return null
  return Math.trunc(value)
}

// --- Unlock gate (these routes are registered before adminRequired) ---------

admin.post("/session", async (c) => {
  const principal = getAuth(c)
  const session = principal.session
  if (!session) return c.json({ error: "Admin access requires a browser session" }, 403)
  if (principal.user.is_admin !== 1) {
    return c.json({ error: "Admin access required", code: "ADMIN_FORBIDDEN" }, 403)
  }

  let ok = false
  try {
    ok = await verifyVoidAuthAdmin(session.accessToken, principal.user.id)
  } catch {
    ok = false
  }

  // Expired access token: refresh once, then re-check the role claim.
  if (!ok && session.refreshToken) {
    try {
      const tokens = await refreshTokens(session.refreshToken, session.scope)
      updateSessionTokens(
        session.id,
        tokens.accessToken,
        tokens.refreshToken || session.refreshToken,
        tokens.scope || session.scope
      )
      ok = await verifyVoidAuthAdmin(tokens.accessToken, principal.user.id)
    } catch {
      ok = false
    }
  }

  if (!ok) {
    return c.json(
      { error: "VoidAuth did not confirm the admin role. Sign in again and retry.", code: "ADMIN_ROLE_UNVERIFIED" },
      403
    )
  }

  const { token, expiresAt } = createAdminSession(
    principal.user.id,
    session.id,
    clientIp(c),
    c.req.header("user-agent") || null
  )
  setCookie(c, config.adminCookie, token, adminCookieOptions(config.adminSessionTtlMinutes * 60))

  const { ip, ua } = meta(c)
  audit({
    actorId: principal.user.id,
    actorEmail: principal.user.email,
    action: "admin.unlock",
    targetType: "admin_session",
    targetId: principal.user.id,
    ip,
    ua,
  })

  return c.json({ active: true, expiresAt })
})

admin.get("/session", async (c) => {
  const principal = getAuth(c)
  const elevated = getAdminSession(getCookie(c, config.adminCookie))
  const active = adminSessionActive(c)
  return c.json({
    isAdmin: principal.user.is_admin === 1,
    active,
    expiresAt: active && elevated ? elevated.expiresAt : null,
  })
})

admin.delete("/session", async (c) => {
  const principal = getAuth(c)
  deleteAdminSession(getCookie(c, config.adminCookie))
  deleteCookie(c, config.adminCookie, adminCookieOptions(0))
  const { ip, ua } = meta(c)
  audit({
    actorId: principal.user.id,
    actorEmail: principal.user.email,
    action: "admin.lock",
    targetType: "admin_session",
    targetId: principal.user.id,
    ip,
    ua,
  })
  return c.json({ ok: true })
})

// Everything below requires the unlocked admin cookie.
admin.use("*", adminRequired)

admin.get("/overview", async (c) => {
  const settings = getSettings()
  const usage = getGlobalUsage()
  return c.json({
    storage: {
      used: usage.used,
      files: usage.count,
      pending: getPendingCount(),
      expiring: getExpiringGlobalCount(),
      downloads: getTotalDownloads(),
    },
    users: { total: countUsers(), admins: countAdmins() },
    settings,
    driver: {
      name: storage.name,
      supportsPresigned: storage.supportsPresign,
      supportsSignedGet: storage.supportsSignedGet,
    },
    retention: { presets: config.retention.presets, minHours: config.retention.minHours },
    recentAudit: listAudit({ limit: 12 }).entries,
  })
})

admin.get("/users", async (c) => {
  const result = listUsers({
    search: c.req.query("search")?.trim() || undefined,
    page: Number(c.req.query("page") || 1) || 1,
    limit: Number(c.req.query("limit") || 40) || 40,
    sort: c.req.query("sort") || undefined,
  })
  const settings = getSettings()
  return c.json({
    users: result.users.map((user) => ({
      ...userDto(user),
      usage: {
        used: Number(user.used_bytes) || 0,
        files: Number(user.file_count) || 0,
        quota: effectiveQuota(user, settings),
        maxUploadBytes: effectiveMaxUpload(user, settings),
      },
    })),
    total: result.total,
    page: result.page,
    limit: result.limit,
  })
})

admin.get("/users/:id", async (c) => {
  const user = getUserById(c.req.param("id"))
  if (!user) return c.json({ error: "User not found" }, 404)
  const settings = getSettings()
  const used = getUsage(user.id)
  return c.json({
    user: userDto(user),
    storage: quotaState(user, settings, used),
    files: getFileCount(user.id),
    expiringSoon: getExpiringCount(user.id),
    limits: {
      quotaBytes: user.quota_bytes > 0 ? user.quota_bytes : null,
      maxUploadBytes: user.max_upload_bytes,
      retentionHours: user.retention_hours,
      retentionLabel: retentionLabel(user.retention_hours),
      effectiveMaxUploadBytes: effectiveMaxUpload(user, settings),
    },
  })
})

admin.patch("/users/:id", async (c) => {
  const target = getUserById(c.req.param("id"))
  if (!target) return c.json({ error: "User not found" }, 404)
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: "Invalid request" }, 400)

  const limits: {
    quotaBytes?: number | null
    maxUploadBytes?: number | null
    retentionHours?: number | null
  } = {}

  if (body.quotaBytes !== undefined) {
    if (typeof body.quotaBytes !== "number" || !Number.isFinite(body.quotaBytes)) {
      return c.json({ error: "quotaBytes must be a number" }, 400)
    }
    const quota = normalizeUnlimited(body.quotaBytes, 1024 * 1024)
    if (quota === null) return c.json({ error: "Quota must be unlimited or at least 1 MB" }, 400)
    limits.quotaBytes = quota
  }

  if (body.maxUploadBytes !== undefined) {
    if (body.maxUploadBytes === null) {
      limits.maxUploadBytes = null
    } else if (typeof body.maxUploadBytes === "number" && Number.isFinite(body.maxUploadBytes)) {
      const max = normalizeUnlimited(body.maxUploadBytes, 1024 * 1024)
      if (max === null) return c.json({ error: "Per-file limit must be unlimited or at least 1 MB" }, 400)
      limits.maxUploadBytes = max
    } else {
      return c.json({ error: "maxUploadBytes must be a number or null" }, 400)
    }
  }

  if (body.retentionHours !== undefined) {
    if (body.retentionHours === null) {
      limits.retentionHours = null
    } else if (typeof body.retentionHours === "number" && Number.isFinite(body.retentionHours)) {
      if (body.retentionHours > 0 && body.retentionHours < config.retention.minHours) {
        return c.json({ error: `Retention must be at least ${config.retention.minHours} hours` }, 400)
      }
      limits.retentionHours = body.retentionHours <= 0 ? -1 : Math.trunc(body.retentionHours)
    } else {
      return c.json({ error: "retentionHours must be a number or null" }, 400)
    }
  }

  const updated = updateUserLimits(target.id, limits)
  if (!updated) return c.json({ error: "User not found" }, 404)

  const principal = getAuth(c)
  const { ip, ua } = meta(c)
  audit({
    actorId: principal.user.id,
    actorEmail: principal.user.email,
    action: "admin.user_limits",
    targetType: "user",
    targetId: target.id,
    meta: { before: { quota: target.quota_bytes, maxUpload: target.max_upload_bytes, retention: target.retention_hours }, after: limits },
    ip,
    ua,
  })

  return c.json({ user: userDto(updated) })
})

admin.get("/files", async (c) => {
  const result = listFiles({
    search: c.req.query("search")?.trim() || undefined,
    type: c.req.query("type") || undefined,
    sort: c.req.query("sort") || undefined,
    visibility: c.req.query("visibility") || undefined,
    expiring: c.req.query("expiring") === "1" || c.req.query("expiring") === "true",
    page: Number(c.req.query("page") || 1) || 1,
    limit: Number(c.req.query("limit") || 40) || 40,
  })
  const items = await Promise.all(result.files.map((file) => fileDto(file)))
  return c.json({ files: items, total: result.total, page: result.page, limit: result.limit })
})

admin.patch("/files/:id", async (c) => {
  const file = getFileById(c.req.param("id"))
  if (!file) return c.json({ error: "File not found" }, 404)
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
  if (body.retentionHours !== undefined) {
    if (body.retentionHours !== null) {
      if (typeof body.retentionHours !== "number" || !Number.isFinite(body.retentionHours)) {
        return c.json({ error: "retentionHours must be a number or null" }, 400)
      }
      if (body.retentionHours > 0 && body.retentionHours < config.retention.minHours) {
        return c.json({ error: `Retention must be at least ${config.retention.minHours} hours` }, 400)
      }
    }
    const hours = body.retentionHours === null || body.retentionHours <= 0 ? null : Math.trunc(body.retentionHours)
    patch.retentionHours = hours
    patch.retentionSource = hours === null ? "unlimited" : "admin"
    patch.expiresAt = hours === null ? null : Date.now() + hours * 60 * 60 * 1000
  }

  if (Object.keys(patch).length === 0) return c.json({ error: "Nothing to update" }, 400)

  const updated = updateFile(file.id, patch)
  if (!updated) return c.json({ error: "File not found" }, 404)

  const principal = getAuth(c)
  const { ip, ua } = meta(c)
  audit({
    actorId: principal.user.id,
    actorEmail: principal.user.email,
    action: "admin.file_update",
    targetType: "file",
    targetId: file.id,
    meta: patch,
    ip,
    ua,
  })
  return c.json({ file: await fileDto(updated) })
})

admin.delete("/files/:id", async (c) => {
  const file = getFileById(c.req.param("id"))
  if (!file) return c.json({ error: "File not found" }, 404)

  await storage.delete(file.key, file.storage_zone as StorageZone).catch(() => {})
  deleteIntentByFile(file.id)
  deleteFileRow(file.id)

  const principal = getAuth(c)
  const { ip, ua } = meta(c)
  audit({
    actorId: principal.user.id,
    actorEmail: principal.user.email,
    action: "admin.file_delete",
    targetType: "file",
    targetId: file.id,
    meta: { name: file.name, owner: file.user_id, size: file.size },
    ip,
    ua,
  })
  return c.json({ ok: true })
})

admin.get("/settings", (c) =>
  c.json({
    settings: getSettings(),
    defaults: defaultSettings(),
    retention: { presets: config.retention.presets, minHours: config.retention.minHours },
    driver: { name: storage.name, supportsPresigned: storage.supportsPresign },
  })
)

admin.patch("/settings", async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: "Invalid request" }, 400)
  const patch: Partial<Settings> = {}

  const numeric = (
    key: keyof Settings,
    min: number,
    allowUnlimited: boolean
  ): string | null => {
    const value = body[key]
    if (value === undefined) return null
    if (typeof value !== "number" || !Number.isFinite(value)) return `${key} must be a number`
    if (allowUnlimited && value <= 0) {
      ;(patch as Record<string, unknown>)[key] = 0
      return null
    }
    if (value < min) return `${key} must be at least ${min}`
    ;(patch as Record<string, unknown>)[key] = Math.trunc(value)
    return null
  }

  for (const [key, min, unlimited] of [
    ["defaultQuotaBytes", 1024 * 1024, true],
    ["maxUploadBytes", 1024 * 1024, true],
    ["largeFileThresholdBytes", 1, false],
    ["largeFileRetentionHours", config.retention.minHours, true],
    ["defaultRetentionHours", config.retention.minHours, true],
  ] as const) {
    const error = numeric(key as keyof Settings, min, unlimited)
    if (error) return c.json({ error }, 400)
  }

  if (body.defaultVisibility !== undefined) {
    if (body.defaultVisibility !== "unlisted" && body.defaultVisibility !== "private") {
      return c.json({ error: "Invalid defaultVisibility" }, 400)
    }
    patch.defaultVisibility = body.defaultVisibility
  }
  if (body.blockedMimeTypes !== undefined) {
    if (typeof body.blockedMimeTypes !== "string") {
      return c.json({ error: "blockedMimeTypes must be a string" }, 400)
    }
    patch.blockedMimeTypes = body.blockedMimeTypes
  }

  if (Object.keys(patch).length === 0) return c.json({ error: "Nothing to update" }, 400)
  const settings = updateSettings(patch)

  const principal = getAuth(c)
  const { ip, ua } = meta(c)
  audit({
    actorId: principal.user.id,
    actorEmail: principal.user.email,
    action: "admin.settings_update",
    targetType: "settings",
    meta: patch,
    ip,
    ua,
  })
  return c.json({ settings })
})

admin.get("/audit", (c) => {
  const result = listAudit({
    limit: Number(c.req.query("limit") || 50) || 50,
    offset: Number(c.req.query("offset") || 0) || 0,
    action: c.req.query("action")?.trim() || undefined,
    actorId: c.req.query("actorId")?.trim() || undefined,
  })
  return c.json(result)
})

admin.get("/system", (c) =>
  c.json({
    driver: storage.name,
    supportsPresigned: storage.supportsPresign,
    supportsSignedGet: storage.supportsSignedGet,
    uploadMode: config.storage.uploadMode,
    bunny: {
      cdnConfigured: Boolean(config.storage.bunny.cdnBaseUrl),
      publicZoneConfigured: Boolean(config.storage.bunny.publicZone),
      privateZoneConfigured: Boolean(config.storage.bunny.privateZone),
      tokenAuthConfigured: Boolean(config.storage.bunny.tokenAuthKey),
    },
    s3: {
      bucket: config.storage.s3.bucket || null,
      endpoint: config.storage.s3.endpoint || null,
      publicBaseConfigured: Boolean(config.storage.s3.publicBaseUrl),
    },
    adminSessionTtlMinutes: config.adminSessionTtlMinutes,
    voidauthUrl: config.voidauthUrl,
    appUrl: config.appUrl,
  })
)

export default admin
