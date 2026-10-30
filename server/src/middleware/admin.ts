import { getCookie } from "hono/cookie"
import type { Context, MiddlewareHandler } from "hono"
import config from "../config.js"
import { getAdminSession } from "../db/admin-sessions.js"
import { getAuth } from "./auth.js"
import { validateBearerToken } from "../lib/oauth.js"
import { syncRole } from "../db/users.js"

/**
 * True when the current request carries a valid elevated admin session that
 * belongs to the signed-in user. Use for optional UI affordances; routes
 * should keep using `adminRequired` for enforcement.
 */
export function adminSessionActive(c: Context): boolean {
  const principal = getAuth(c)
  if (!principal?.session || principal.user.is_admin !== 1) return false
  const admin = getAdminSession(getCookie(c, config.adminCookie))
  return !!admin && admin.userId === principal.user.id && admin.sessionId === principal.session.id
}

export const adminRequired: MiddlewareHandler = async (c, next) => {
  const principal = getAuth(c)
  if (!principal) return c.json({ error: "Not authenticated" }, 401)
  if (principal.source !== "cookie" || !principal.session) {
    return c.json({ error: "Admin access requires a browser session", code: "ADMIN_SESSION_REQUIRED" }, 403)
  }
  if (principal.user.is_admin !== 1) {
    return c.json({ error: "Admin access required", code: "ADMIN_FORBIDDEN" }, 403)
  }

  const token = getCookie(c, config.adminCookie)
  const admin = getAdminSession(token)
  if (!admin || admin.userId !== principal.user.id || admin.sessionId !== principal.session.id) {
    return c.json({ error: "Admin panel is locked", code: "ADMIN_LOCKED" }, 423)
  }

  await next()
}

/**
 * Re-check the live VoidAuth role before unlocking the admin panel. This is the
 * "lock gate": local is_admin is only a cache; the token's role claim is truth.
 */
export async function verifyVoidAuthAdmin(accessToken: string, userId: string): Promise<boolean> {
  const info = await validateBearerToken(accessToken, true)
  if (!info.id || info.id !== userId) return false
  const user = syncRole(userId, info.role)
  return !!user && user.is_admin === 1
}
