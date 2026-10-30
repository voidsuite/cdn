import { db, now } from "./connection.js"
import config from "../config.js"
import { getSettings } from "./settings.js"

export interface StoredUser {
  id: string
  email: string
  name: string
  picture: string | null
  role: string
  is_admin: number
  quota_bytes: number
  max_upload_bytes: number | null
  retention_hours: number | null
  created_at: number
  last_seen_at: number
}

export interface UserInput {
  id: string
  name: string
  email: string
  picture?: string | null
  role?: string
}

const insertUser = db.query(`
  INSERT INTO users (id, email, name, picture, role, is_admin, quota_bytes, created_at, last_seen_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    email = excluded.email,
    name = excluded.name,
    picture = COALESCE(excluded.picture, users.picture),
    last_seen_at = excluded.last_seen_at
`)
const selectUser = db.query("SELECT * FROM users WHERE id = ?")
const selectUserByEmail = db.query("SELECT * FROM users WHERE lower(email) = lower(?)")
const updateRole = db.query("UPDATE users SET role = ?, is_admin = ? WHERE id = ?")
const updatePicture = db.query("UPDATE users SET picture = ? WHERE id = ?")
const updateLimits = db.query(`
  UPDATE users SET quota_bytes = ?, max_upload_bytes = ?, retention_hours = ? WHERE id = ?
`)
const updateQuotaOnly = db.query("UPDATE users SET quota_bytes = ? WHERE id = ?")
const touch = db.query("UPDATE users SET last_seen_at = ? WHERE id = ?")

export function isAdminEmail(email: string): boolean {
  return config.adminEmails.includes(email.trim().toLowerCase())
}

export function upsertUser(input: UserInput): StoredUser {
  const settings = getSettings()
  const exists = selectUser.get(input.id) as StoredUser | null
  const role = input.role || exists?.role || "user"
  const admin = input.role ? role === "admin" : false
  insertUser.run(
    input.id,
    input.email,
    input.name,
    input.picture ?? null,
    role,
    admin ? 1 : 0,
    exists?.quota_bytes ?? settings.defaultQuotaBytes,
    now(),
    now()
  )

  // If VoidAuth sent a role, it is authoritative. If it did not, the optional
  // email allowlist is a local fallback (useful before the auth role scope is
  // deployed). Never silently demote an existing admin on a missing claim.
  if (input.role) {
    updateRole.run(role, role === "admin" ? 1 : 0, input.id)
  } else if (isAdminEmail(input.email)) {
    updateRole.run(exists?.role || "admin", 1, input.id)
  }

  return selectUser.get(input.id) as StoredUser
}

export function syncRole(userId: string, role?: string | null, picture?: string | null): StoredUser | null {
  const user = selectUser.get(userId) as StoredUser | null
  if (!user) return null
  if (role) {
    const isAdmin = role === "admin" ? 1 : 0
    updateRole.run(role, isAdmin, userId)
  } else if (isAdminEmail(user.email)) {
    updateRole.run(user.role || "admin", 1, userId)
  }
  // VoidAuth's `picture` claim is the avatar URL; refresh it when it changes.
  if (picture && picture !== user.picture) updatePicture.run(picture, userId)
  return selectUser.get(userId) as StoredUser
}

export function getUserById(id: string): StoredUser | null {
  return (selectUser.get(id) as StoredUser | null) ?? null
}

export function getUserByEmail(email: string): StoredUser | null {
  return (selectUserByEmail.get(email) as StoredUser | null) ?? null
}

export function touchUser(id: string): void {
  touch.run(now(), id)
}

export function updateUserLimits(
  userId: string,
  limits: { quotaBytes?: number | null; maxUploadBytes?: number | null; retentionHours?: number | null }
): StoredUser | null {
  const user = getUserById(userId)
  if (!user) return null
  const quota = limits.quotaBytes === undefined ? user.quota_bytes : (limits.quotaBytes ?? -1)
  const maxUpload =
    limits.maxUploadBytes === undefined ? user.max_upload_bytes : limits.maxUploadBytes
  const retention =
    limits.retentionHours === undefined ? user.retention_hours : limits.retentionHours
  updateLimits.run(quota, maxUpload, retention, userId)
  return getUserById(userId)
}

export function setDefaultQuotaForNewUsers(bytes: number): void {
  db.query("UPDATE settings SET value = ? WHERE key = 'defaultQuotaBytes'").run(String(bytes))
}

export function applyDefaultQuotaToExisting(bytes: number): void {
  // Only touch users that still have the previous bootstrap default.
  updateQuotaOnly.run(bytes, bytes)
}

export interface AdminUserRow extends StoredUser {
  used_bytes: number
  file_count: number
}

export function listUsers(
  options: { search?: string; page?: number; limit?: number; sort?: string } = {}
): { users: AdminUserRow[]; total: number; page: number; limit: number } {
  const page = Math.max(options.page ?? 1, 1)
  const limit = Math.min(Math.max(options.limit ?? 40, 1), 100)
  const offset = (page - 1) * limit
  const where: string[] = []
  const params: (string | number | null)[] = []

  if (options.search) {
    where.push("(lower(u.name) LIKE ? OR lower(u.email) LIKE ?)")
    const q = `%${options.search.toLowerCase()}%`
    params.push(q, q)
  }

  const sort = options.sort || "recent"
  const orderBy =
    sort === "name" ? "lower(u.name) ASC" :
    sort === "usage" ? "used_bytes DESC" :
    sort === "oldest" ? "u.created_at ASC" :
    "u.last_seen_at DESC"

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const rows = db
    .query(
      `SELECT u.*,
         (SELECT COALESCE(SUM(f.size), 0) FROM files f
            WHERE f.user_id = u.id AND f.status = 'ready') AS used_bytes,
         (SELECT COUNT(*) FROM files f
            WHERE f.user_id = u.id AND f.status = 'ready') AS file_count
       FROM users u ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as AdminUserRow[]
  const total = db
    .query(`SELECT COUNT(*) AS count FROM users u ${clause}`)
    .get(...params) as { count: number }

  return { users: rows, total: Number(total.count), page, limit }
}

export function countUsers(): number {
  const row = db.query("SELECT COUNT(*) AS count FROM users").get() as { count: number }
  return Number(row.count) || 0
}

export function countAdmins(): number {
  const row = db.query("SELECT COUNT(*) AS count FROM users WHERE is_admin = 1").get() as { count: number }
  return Number(row.count) || 0
}

export function setAdmin(userId: string, admin: boolean): StoredUser | null {
  updateRole.run(admin ? "admin" : "user", admin ? 1 : 0, userId)
  return getUserById(userId)
}
