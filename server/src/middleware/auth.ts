import { getCookie } from "hono/cookie"
import type { Context, MiddlewareHandler } from "hono"
import { getCookieName, getSession, type SessionData } from "../db/sessions.js"
import { getUserById, type StoredUser } from "../db/users.js"
import { getApiToken } from "../db/tokens.js"
import { audit } from "../db/audit.js"

export interface AuthPrincipal {
  user: StoredUser
  source: "cookie" | "api-token"
  session?: SessionData
  scopes: string[]
  apiTokenId?: string
}

export function getAuth(c: Context): AuthPrincipal {
  return c.get("auth") as AuthPrincipal
}

export function authScopes(principal: AuthPrincipal): string[] {
  return principal.scopes
}

const READ_SCOPES = ["files:read", "files:share", "stats:read", "read"]
const WRITE_SCOPES = ["files:upload", "files:delete", "write"]

/**
 * Admins can always read/manage, and the coarse VoidAuth `read`/`write`
 * scopes grant the matching fine-grained CDN scopes. API tokens use the
 * fine-grained names directly.
 */
export function hasScope(principal: AuthPrincipal, scope: string): boolean {
  if (principal.user.is_admin === 1) return true
  if (principal.scopes.includes(scope)) return true
  if (principal.scopes.length === 0) return READ_SCOPES.includes(scope) || scope === "read"
  if (WRITE_SCOPES.includes(scope)) return principal.scopes.some((s) => WRITE_SCOPES.includes(s))
  if (READ_SCOPES.includes(scope)) return principal.scopes.some((s) => READ_SCOPES.includes(s))
  return false
}

export const authRequired: MiddlewareHandler = async (c, next) => {
  const sid = getCookie(c, getCookieName())
  const session = getSession(sid)
  if (session) {
    c.set("auth", {
      user: session.user,
      source: "cookie",
      session,
      scopes: session.scope.split(/[\s,]+/).filter(Boolean),
    } satisfies AuthPrincipal)
    await next()
    return
  }

  const header = c.req.header("Authorization") || ""
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (match && match[1].startsWith("vcdn_")) {
    const token = getApiToken(match[1])
    if (token) {
      const user = getUserById(token.row.user_id)
      if (user) {
        c.set("auth", {
          user,
          source: "api-token",
          scopes: token.scopes,
          apiTokenId: token.row.id,
        } satisfies AuthPrincipal)
        await next()
        return
      }
    }
  }

  return c.json({ error: "Not authenticated" }, 401)
}

export const authOptional: MiddlewareHandler = async (c, next) => {
  const sid = getCookie(c, getCookieName())
  const session = getSession(sid)
  if (session) {
    c.set("auth", {
      user: session.user,
      source: "cookie",
      session,
      scopes: session.scope.split(/[\s,]+/).filter(Boolean),
    } satisfies AuthPrincipal)
    await next()
    return
  }

  const header = c.req.header("Authorization") || ""
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (match && match[1].startsWith("vcdn_")) {
    const token = getApiToken(match[1])
    if (token) {
      const user = getUserById(token.row.user_id)
      if (user) {
        c.set("auth", {
          user,
          source: "api-token",
          scopes: token.scopes,
          apiTokenId: token.row.id,
        } satisfies AuthPrincipal)
      }
    }
  }
  await next()
}

export function requireScope(scope: string, message = "You do not have permission for this action."): MiddlewareHandler {
  return async (c, next) => {
    const principal = getAuth(c)
    if (!principal || !hasScope(principal, scope)) {
      audit({
        actorId: principal?.user.id,
        actorEmail: principal?.user.email,
        action: "permission.denied",
        targetType: "scope",
        targetId: scope,
        ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || null,
        ua: c.req.header("user-agent") || null,
      })
      return c.json({ error: message }, 403)
    }
    await next()
  }
}

export function clientIp(c: Context): string | null {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || null
}
