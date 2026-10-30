/**
 * /api/auth/* — VoidAuth OAuth proxy with PKCE.
 * The client secret stays on the server; the browser only receives an
 * httpOnly session cookie. The session remembers the granted OAuth scopes so
 * read/write permissions can be enforced per request.
 */

import { Hono } from "hono"
import { setCookie, deleteCookie, getCookie } from "hono/cookie"
import config from "../config.js"
import {
  createSession,
  deleteSessionById,
  getCookieName,
  getSession,
  getSessionCookieOptions,
  updateSessionTokens,
} from "../db/sessions.js"
import { storePkceState, takePkceVerifier } from "../db/pkce.js"
import {
  buildAuthorizeParams,
  authorizeUrl,
  exchangeCode,
  refreshTokens,
  revokeToken,
  validateBearerToken,
  decodeJwtPayload,
} from "../lib/oauth.js"
import { syncRole, upsertUser, type StoredUser } from "../db/users.js"
import { userDto } from "../lib/dto.js"
import { deleteAdminSessionsForUser, adminCookieOptions } from "../db/admin-sessions.js"
import { audit } from "../db/audit.js"
import { clientIp, getAuth, authRequired } from "../middleware/auth.js"

const PKCE_STATE_COOKIE = "voidcdn_pkce_state"

function stateCookieOptions(): Record<string, string | boolean | number> {
  return {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.appUrl.startsWith("https://"),
    path: "/",
    maxAge: 10 * 60,
  }
}

function roleFromTokens(tokens: { user?: { role?: string }; idToken?: string }): string | undefined {
  if (tokens.user?.role) return tokens.user.role
  if (tokens.idToken) {
    const payload = decodeJwtPayload(tokens.idToken)
    if (payload && typeof payload.role === "string") return payload.role
  }
  return undefined
}

/** VoidAuth exposes the avatar as a `picture` claim (id_token or userinfo). */
function pictureFromTokens(tokens: { user?: { picture?: string }; idToken?: string }): string | undefined {
  if (tokens.user?.picture) return tokens.user.picture
  if (tokens.idToken) {
    const payload = decodeJwtPayload(tokens.idToken)
    if (payload && typeof payload.picture === "string") return payload.picture
  }
  return undefined
}

/**
 * Pull role/avatar from the live VoidAuth userinfo endpoint. When the avatar
 * is still missing the call is forced so a fresh upload shows up; otherwise
 * the short-lived cache keeps `/api/auth/me` cheap.
 */
async function refreshProfile(user: StoredUser, accessToken: string): Promise<StoredUser> {
  try {
    const info = await validateBearerToken(accessToken, !user.picture)
    if (info.id !== user.id) return user
    return syncRole(user.id, info.role, info.picture) ?? user
  } catch {
    return user
  }
}

const auth = new Hono()

// GET /api/auth/login → { authUrl } (starts PKCE, binds state to this browser)
auth.get("/login", async (c) => {
  const { params, verifier, state } = buildAuthorizeParams()
  storePkceState(state, verifier)
  setCookie(c, PKCE_STATE_COOKIE, state, stateCookieOptions())
  return c.json({ authUrl: authorizeUrl(params) })
})

// POST /api/auth/exchange — swap the code, create a session cookie
auth.post("/exchange", async (c) => {
  const body = await c.req.json().catch(() => null)
  const code = body?.code as string | undefined
  const state = body?.state as string | undefined
  const keepMeLoggedIn = body?.keepMeLoggedIn !== false

  if (!code || !state) return c.json({ error: "Missing code or state" }, 400)

  const stateCookie = getCookie(c, PKCE_STATE_COOKIE)
  if (!stateCookie || stateCookie !== state) {
    return c.json({ error: "Invalid OAuth state" }, 400)
  }
  const verifier = takePkceVerifier(state)
  if (!verifier) return c.json({ error: "Invalid or expired state" }, 400)
  deleteCookie(c, PKCE_STATE_COOKIE)

  try {
    const tokens = await exchangeCode(code, verifier)
    let oidcUser = tokens.user
    if (!oidcUser?.id) {
      const info = await validateBearerToken(tokens.accessToken)
      oidcUser = { id: info.id, name: info.name, email: info.email, picture: info.picture, role: info.role }
    }

    const user = upsertUser({
      id: oidcUser?.id || "",
      name: oidcUser?.name || "",
      email: oidcUser?.email || "",
      picture: oidcUser?.picture || pictureFromTokens(tokens),
      role: roleFromTokens(tokens),
    })

    const sessionId = createSession(
      {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          picture: user.picture,
          role: user.role,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || "",
        scope: tokens.scope || "",
      },
      keepMeLoggedIn
    )
    const cookieMaxAge = keepMeLoggedIn ? 30 * 24 * 60 * 60 : undefined
    setCookie(c, getCookieName(), sessionId, getSessionCookieOptions(cookieMaxAge))

    audit({
      actorId: user.id,
      actorEmail: user.email,
      action: "auth.login",
      targetType: "user",
      targetId: user.id,
      ip: clientIp(c),
      ua: c.req.header("user-agent") || null,
    })

    return c.json({ user: userDto(user) })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

// POST /api/auth/browser-session — browser SDK mode: mint a session from a validated token
auth.post("/browser-session", async (c) => {
  const body = await c.req.json().catch(() => null)
  const accessToken = body?.accessToken as string | undefined
  const scope = (body?.scope as string | undefined) || ""
  if (!accessToken) return c.json({ error: "Missing access token" }, 400)

  try {
    const info = await validateBearerToken(accessToken, true)
    const user = upsertUser({
      id: info.id,
      name: info.name,
      email: info.email,
      picture: info.picture,
      role: info.role,
    })
    const sessionId = createSession(
      {
        user: { id: user.id, name: user.name, email: user.email, picture: user.picture, role: user.role },
        accessToken,
        refreshToken: "",
        scope,
      },
      true
    )
    setCookie(c, getCookieName(), sessionId, getSessionCookieOptions(30 * 24 * 60 * 60))
    return c.json({ user: userDto(user) })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

// POST /api/auth/refresh — refresh the VoidAuth access token, extend the session
auth.post("/refresh", async (c) => {
  const sessionId = getCookie(c, getCookieName())
  if (!sessionId) return c.json({ error: "No session" }, 401)

  const session = getSession(sessionId)
  if (!session || !session.refreshToken) {
    if (sessionId) deleteCookie(c, getCookieName())
    return c.json({ error: "Session expired" }, 401)
  }

  try {
    const tokens = await refreshTokens(session.refreshToken, session.scope)
    updateSessionTokens(
      sessionId,
      tokens.accessToken,
      tokens.refreshToken || session.refreshToken,
      tokens.scope || session.scope
    )
    const user = syncRole(session.user.id, roleFromTokens(tokens)) || session.user
    const cookieMaxAge = session.keepMeLoggedIn ? 30 * 24 * 60 * 60 : undefined
    setCookie(c, getCookieName(), sessionId, getSessionCookieOptions(cookieMaxAge))
    return c.json({ ok: true, user: userDto(user) })
  } catch {
    deleteSessionById(sessionId)
    deleteCookie(c, getCookieName())
    return c.json({ error: "Session expired" }, 401)
  }
})

// GET /api/auth/me — current user (validates the session, refreshes role quietly)
auth.get("/me", authRequired, async (c) => {
  const principal = getAuth(c)
  const session = principal.session
  if (!session) return c.json({ error: "Not authenticated" }, 401)

  const user = await refreshProfile(principal.user, session.accessToken)
  return c.json({
    user: userDto(user),
    scopes: principal.scopes,
  })
})

// GET /api/auth/session — cross-app convenience check
auth.get("/session", authRequired, async (c) => {
  const principal = getAuth(c)
  return c.json({ authenticated: true, user: userDto(principal.user) })
})

// POST /api/auth/logout — revoke token, clear session and admin elevation
auth.post("/logout", async (c) => {
  const sessionId = getCookie(c, getCookieName())
  if (sessionId) {
    const session = getSession(sessionId)
    if (session) {
      deleteAdminSessionsForUser(session.user.id)
      if (session.accessToken) await revokeToken(session.accessToken)
      deleteSessionById(sessionId)
    }
    deleteCookie(c, getCookieName())
  }
  deleteCookie(c, config.adminCookie, adminCookieOptions(0))
  return c.json({ ok: true })
})

export default auth
