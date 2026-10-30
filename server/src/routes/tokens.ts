/**
 * /api/tokens — personal API tokens for scripts and CI.
 * Only a browser session may create/revoke tokens; the tokens themselves are
 * shown once and stored as SHA-256 hashes.
 */

import { Hono } from "hono"
import { authRequired, getAuth, clientIp } from "../middleware/auth.js"
import { createApiToken, listApiTokens, revokeApiToken, TOKEN_SCOPES } from "../db/tokens.js"
import { audit } from "../db/audit.js"

const tokens = new Hono()

tokens.use("*", authRequired)

function browserOnly(c: Parameters<typeof clientIp>[0]) {
  const principal = getAuth(c)
  return principal.source === "cookie" ? principal : null
}

tokens.get("/", (c) => {
  const principal = browserOnly(c)
  if (!principal) return c.json({ error: "Token management requires a browser session" }, 403)
  return c.json({ tokens: listApiTokens(principal.user.id), scopes: TOKEN_SCOPES })
})

tokens.post("/", async (c) => {
  const principal = browserOnly(c)
  if (!principal) return c.json({ error: "Token management requires a browser session" }, 403)

  const body = await c.req.json().catch(() => null)
  const name = String(body?.name || "").trim().slice(0, 64)
  if (!name) return c.json({ error: "Give the token a name" }, 400)

  const requested = Array.isArray(body?.scopes) ? (body.scopes as unknown[]) : []
  const scopes = requested
    .filter((scope): scope is string => typeof scope === "string")
    .filter((scope) => (TOKEN_SCOPES as readonly string[]).includes(scope))
  if (scopes.length === 0) return c.json({ error: "Pick at least one scope" }, 400)
  if (scopes.length !== new Set(scopes).size) {
    return c.json({ error: "Duplicate scopes" }, 400)
  }

  let expiresAt: number | null = null
  const days = body?.expiresInDays
  if (days !== undefined && days !== null) {
    if (typeof days !== "number" || !Number.isFinite(days) || days <= 0 || days > 3650) {
      return c.json({ error: "expiresInDays must be between 1 and 3650" }, 400)
    }
    expiresAt = Date.now() + Math.trunc(days) * 24 * 60 * 60 * 1000
  }

  const { token, row } = createApiToken(
    principal.user.id,
    name,
    scopes as import("../db/tokens.js").TokenScope[],
    expiresAt
  )

  const { ip, ua } = { ip: clientIp(c), ua: c.req.header("user-agent") || null }
  audit({
    actorId: principal.user.id,
    actorEmail: principal.user.email,
    action: "token.create",
    targetType: "api_token",
    targetId: row.id,
    meta: { name, scopes },
    ip,
    ua,
  })

  return c.json({
    token,
    apiToken: {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scopes,
      expiresAt,
      createdAt: row.created_at,
    },
  })
})

tokens.delete("/:id", (c) => {
  const principal = browserOnly(c)
  if (!principal) return c.json({ error: "Token management requires a browser session" }, 403)
  const ok = revokeApiToken(principal.user.id, c.req.param("id"))
  if (!ok) return c.json({ error: "Token not found" }, 404)

  const { ip, ua } = { ip: clientIp(c), ua: c.req.header("user-agent") || null }
  audit({
    actorId: principal.user.id,
    actorEmail: principal.user.email,
    action: "token.revoke",
    targetType: "api_token",
    targetId: c.req.param("id"),
    ip,
    ua,
  })
  return c.json({ ok: true })
})

export default tokens
