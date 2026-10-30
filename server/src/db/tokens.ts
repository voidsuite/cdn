import { db, now } from "./connection.js"
import { hashToken, newToken, tokenPrefix, uuid } from "../lib/ids.js"

export const TOKEN_SCOPES = ["files:read", "files:upload", "files:delete", "files:share", "stats:read"] as const
export type TokenScope = (typeof TOKEN_SCOPES)[number]

export interface ApiTokenRow {
  id: string
  user_id: string
  name: string
  token_hash: string
  prefix: string
  scopes: string
  last_used_at: number | null
  expires_at: number | null
  revoked_at: number | null
  created_at: number
}

const insert = db.query(`
  INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, scopes, expires_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)
const selectForUser = db.query("SELECT * FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC")
const selectByHash = db.query("SELECT * FROM api_tokens WHERE token_hash = ?")
const remove = db.query("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ?")
const touch = db.query("UPDATE api_tokens SET last_used_at = ? WHERE id = ?")

export function createApiToken(
  userId: string,
  name: string,
  scopes: TokenScope[],
  expiresAt?: number | null
): { token: string; row: ApiTokenRow } {
  const token = `vcdn_${newToken(32)}`
  const id = uuid()
  insert.run(id, userId, name, hashToken(token), tokenPrefix(token), JSON.stringify(scopes), expiresAt ?? null, now())
  const row = selectByHash.get(hashToken(token)) as ApiTokenRow
  return { token, row }
}

export function listApiTokens(userId: string) {
  const rows = selectForUser.all(userId) as ApiTokenRow[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: JSON.parse(r.scopes) as string[],
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }))
}

export function getApiToken(token: string): { row: ApiTokenRow; scopes: string[] } | null {
  const row = selectByHash.get(hashToken(token)) as ApiTokenRow | null
  if (!row || row.revoked_at) return null
  if (row.expires_at && row.expires_at <= now()) return null
  touch.run(now(), row.id)
  return { row, scopes: JSON.parse(row.scopes) as string[] }
}

export function revokeApiToken(userId: string, id: string): boolean {
  const before = db.query("SELECT id FROM api_tokens WHERE id = ? AND user_id = ? AND revoked_at IS NULL").get(id, userId)
  if (!before) return false
  remove.run(now(), id, userId)
  return true
}
