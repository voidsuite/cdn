import { db, now } from "./connection.js"
import { hashToken, newToken, uuid } from "../lib/ids.js"
import config from "../config.js"

export interface AdminSession {
  id: string
  userId: string
  sessionId: string
  expiresAt: number
}

const insert = db.query(`
  INSERT INTO admin_sessions (id, user_id, session_id, token_hash, expires_at, created_at, last_used_at, ip, ua)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const selectByHash = db.query("SELECT * FROM admin_sessions WHERE token_hash = ?")
const touch = db.query("UPDATE admin_sessions SET last_used_at = ? WHERE id = ?")
const remove = db.query("DELETE FROM admin_sessions WHERE id = ?")
const removeByUser = db.query("DELETE FROM admin_sessions WHERE user_id = ?")
const removeExpired = db.query("DELETE FROM admin_sessions WHERE expires_at < ?")

export function createAdminSession(
  userId: string,
  sessionId: string,
  ip?: string | null,
  ua?: string | null
): { token: string; expiresAt: number } {
  const token = newToken(32)
  const id = uuid()
  const expiresAt = now() + config.adminSessionTtlMinutes * 60 * 1000
  insert.run(id, userId, sessionId, hashToken(token), expiresAt, now(), now(), ip ?? null, ua ?? null)
  removeExpired.run(now())
  return { token, expiresAt }
}

export function getAdminSession(token: string | undefined): AdminSession | null {
  if (!token) return null
  const row = selectByHash.get(hashToken(token)) as Record<string, unknown> | null
  if (!row) return null
  const expiresAt = Number(row.expires_at)
  if (expiresAt <= now()) {
    remove.run(String(row.id))
    return null
  }
  touch.run(now(), String(row.id))
  return {
    id: String(row.id),
    userId: String(row.user_id),
    sessionId: String(row.session_id),
    expiresAt,
  }
}

export function deleteAdminSession(token: string | undefined): void {
  if (!token) return
  const row = selectByHash.get(hashToken(token)) as { id: string } | null
  if (row) remove.run(row.id)
}

export function deleteAdminSessionsForUser(userId: string): void {
  removeByUser.run(userId)
}

export function adminCookieOptions(maxAge?: number): Record<string, string | boolean | number> {
  const options: Record<string, string | boolean | number> = {
    httpOnly: true,
    sameSite: "Strict",
    path: "/api/admin",
    secure: config.appUrl.startsWith("https://"),
  }
  if (maxAge !== undefined) options.maxAge = maxAge
  return options
}
