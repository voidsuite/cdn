import { db, now } from "./connection.js"
import { newToken } from "../lib/ids.js"
import config from "../config.js"
import { getUserById, upsertUser, type UserInput, type StoredUser } from "./users.js"

export interface SessionData {
  id: string
  user: StoredUser
  accessToken: string
  refreshToken: string
  scope: string
  expiresAt: number
  keepMeLoggedIn: boolean
}

const SESSION_DURATION_KMLI = 30 * 24 * 60 * 60 * 1000
const SESSION_DURATION_DEFAULT = 7 * 24 * 60 * 60 * 1000

const insertSession = db.query(`
  INSERT INTO sessions (id, user_id, access_token, refresh_token, scope, expires_at, keep_me_logged_in, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)
const selectSession = db.query("SELECT * FROM sessions WHERE id = ?")
const deleteSession = db.query("DELETE FROM sessions WHERE id = ?")
const deleteExpired = db.query("DELETE FROM sessions WHERE expires_at < ?")
const updateTokens = db.query(
  "UPDATE sessions SET access_token = ?, refresh_token = ?, scope = ?, expires_at = ? WHERE id = ?"
)

export function getCookieName(): string {
  return config.sessionCookie
}

export function createSession(
  data: { user: UserInput; accessToken: string; refreshToken: string; scope?: string },
  keepMeLoggedIn = true
): string {
  const id = newToken(32)
  const kmli = keepMeLoggedIn !== false
  const duration = kmli ? SESSION_DURATION_KMLI : SESSION_DURATION_DEFAULT
  upsertUser(data.user)
  insertSession.run(id, data.user.id, data.accessToken, data.refreshToken, data.scope || "", now() + duration, kmli ? 1 : 0, now())
  return id
}

export function getSession(id: string | undefined): SessionData | null {
  if (!id) return null
  const row = selectSession.get(id) as Record<string, unknown> | null
  if (!row) return null
  if (now() > Number(row.expires_at)) {
    deleteSession.run(id)
    return null
  }
  const user = getUserById(String(row.user_id))
  if (!user) return null
  return {
    id: String(row.id),
    user,
    accessToken: String(row.access_token),
    refreshToken: String(row.refresh_token),
    scope: String(row.scope || ""),
    expiresAt: Number(row.expires_at),
    keepMeLoggedIn: Number(row.keep_me_logged_in) === 1,
  }
}

export function updateSessionTokens(
  id: string,
  accessToken: string,
  refreshToken: string,
  scope: string,
  extend = true
): void {
  const session = getSession(id)
  if (!session) return
  const expiresAt = extend ? now() + SESSION_DURATION_KMLI : session.expiresAt
  updateTokens.run(accessToken, refreshToken, scope, expiresAt, id)
}

export function deleteSessionById(id: string): void {
  deleteSession.run(id)
}

export function getSessionCookieOptions(maxAge?: number): Record<string, string | boolean | number> {
  const options: Record<string, string | boolean | number> = {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: isSecure(),
  }
  if (maxAge !== undefined) options.maxAge = maxAge
  return options
}

export function isSecure(): boolean {
  return config.appUrl.startsWith("https://")
}

setInterval(() => {
  deleteExpired.run(now())
}, 10 * 60 * 1000).unref?.()
