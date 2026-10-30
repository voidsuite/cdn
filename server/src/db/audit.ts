import { db, now } from "./connection.js"
import { uuid } from "../lib/ids.js"

export interface AuditEntry {
  actorId?: string | null
  actorEmail?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  meta?: Record<string, unknown> | null
  ip?: string | null
  ua?: string | null
}

const insert = db.query(`
  INSERT INTO audit_log (id, actor_id, actor_email, action, target_type, target_id, meta, ip, ua, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

export function audit(entry: AuditEntry): void {
  insert.run(
    uuid(),
    entry.actorId ?? null,
    entry.actorEmail ?? null,
    entry.action,
    entry.targetType ?? null,
    entry.targetId ?? null,
    entry.meta ? JSON.stringify(entry.meta) : null,
    entry.ip ?? null,
    entry.ua ?? null,
    now()
  )
}

export function listAudit(options: { limit?: number; offset?: number; action?: string; actorId?: string } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const offset = Math.max(options.offset ?? 0, 0)
  const where: string[] = []
  const params: (string | number | null)[] = []
  if (options.action) {
    where.push("action = ?")
    params.push(options.action)
  }
  if (options.actorId) {
    where.push("actor_id = ?")
    params.push(options.actorId)
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const rows = db
    .query(`SELECT * FROM audit_log ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Record<string, unknown>[]
  const total = db
    .query(`SELECT COUNT(*) AS count FROM audit_log ${clause}`)
    .get(...params) as { count: number }
  return {
    entries: rows.map((r) => ({
      id: String(r.id),
      actorId: r.actor_id ? String(r.actor_id) : null,
      actorEmail: r.actor_email ? String(r.actor_email) : null,
      action: String(r.action),
      targetType: r.target_type ? String(r.target_type) : null,
      targetId: r.target_id ? String(r.target_id) : null,
      meta: r.meta ? JSON.parse(String(r.meta)) : null,
      ip: r.ip ? String(r.ip) : null,
      ua: r.ua ? String(r.ua) : null,
      createdAt: Number(r.created_at),
    })),
    total: Number(total.count),
  }
}
