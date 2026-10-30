import { db, now } from "./connection.js"

export type Visibility = "unlisted" | "private"

export interface FileRow {
  id: string
  user_id: string
  key: string
  name: string
  mime: string
  size: number
  etag: string | null
  visibility: Visibility
  status: "pending" | "ready"
  storage_driver: string
  storage_zone: string
  expires_at: number | null
  retention_hours: number | null
  retention_source: string
  downloads: number
  last_downloaded_at: number | null
  created_at: number
  updated_at: number
  deleted_at: number | null
  owner_name?: string
  owner_email?: string
}

export interface CreateFileInput {
  id: string
  userId: string
  key: string
  name: string
  mime: string
  size: number
  visibility: Visibility
  storageDriver: string
  storageZone: string
  expiresAt: number | null
  retentionHours: number | null
  retentionSource: string
}

const insertFile = db.query(`
  INSERT INTO files (id, user_id, key, name, mime, size, visibility, status, storage_driver, storage_zone,
                     expires_at, retention_hours, retention_source, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
`)
const selectFile = db.query("SELECT * FROM files WHERE id = ? AND status != 'deleted'")
const selectByKey = db.query("SELECT * FROM files WHERE key = ? AND status = 'ready'")
const selectFileForUser = db.query("SELECT * FROM files WHERE id = ? AND user_id = ? AND status != 'deleted'")
const updateReady = db.query(`
  UPDATE files SET size = ?, etag = ?, status = 'ready', updated_at = ? WHERE id = ?
`)
const removeFile = db.query("DELETE FROM files WHERE id = ?")
const selectExpired = db.query(
  "SELECT * FROM files WHERE status = 'ready' AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at ASC LIMIT ?"
)
const selectReadyCount = db.query("SELECT COUNT(*) AS count FROM files WHERE user_id = ? AND status = 'ready'")
const selectReadyUsage = db.query(
  "SELECT COALESCE(SUM(size), 0) AS used FROM files WHERE user_id = ? AND status = 'ready'"
)
const selectReservedUsage = db.query(
  "SELECT COALESCE(SUM(size), 0) AS used FROM files WHERE user_id = ? AND status IN ('ready', 'pending')"
)
const selectExpiring = db.query(
  "SELECT COUNT(*) AS count FROM files WHERE user_id = ? AND status = 'ready' AND expires_at IS NOT NULL AND expires_at <= ?"
)
const selectAllUsage = db.query("SELECT COALESCE(SUM(size), 0) AS used FROM files WHERE status = 'ready'")
const selectAllCount = db.query("SELECT COUNT(*) AS count FROM files WHERE status = 'ready'")
const selectExpiringAll = db.query(
  "SELECT COUNT(*) AS count FROM files WHERE status = 'ready' AND expires_at IS NOT NULL AND expires_at <= ?"
)
const selectPendingAll = db.query("SELECT COUNT(*) AS count FROM files WHERE status = 'pending'")
const selectDownloads = db.query("SELECT COALESCE(SUM(downloads), 0) AS count FROM files WHERE status = 'ready'")
const selectStalePending = db.query(
  "SELECT * FROM files WHERE status = 'pending' AND created_at <= ? ORDER BY created_at ASC LIMIT ?"
)
const touchDownload = db.query(
  "UPDATE files SET downloads = downloads + 1, last_downloaded_at = ? WHERE id = ?"
)

export function createPendingFile(input: CreateFileInput): FileRow {
  insertFile.run(
    input.id,
    input.userId,
    input.key,
    input.name,
    input.mime,
    input.size,
    input.visibility,
    input.storageDriver,
    input.storageZone,
    input.expiresAt,
    input.retentionHours,
    input.retentionSource,
    now(),
    now()
  )
  return getFileById(input.id) as FileRow
}

export function getFileById(id: string): FileRow | null {
  return (selectFile.get(id) as FileRow | null) ?? null
}

export function getFileByKey(key: string): FileRow | null {
  return (selectByKey.get(key) as FileRow | null) ?? null
}

export function getFileForUser(id: string, userId: string): FileRow | null {
  return (selectFileForUser.get(id, userId) as FileRow | null) ?? null
}

export function markFileReady(id: string, size: number, etag: string | null): FileRow | null {
  updateReady.run(size, etag, now(), id)
  return getFileById(id)
}

export function updateFile(
  id: string,
  patch: {
    name?: string | null
    visibility?: Visibility | null
    expiresAt?: number | null
    retentionHours?: number | null
    retentionSource?: string | null
  }
): FileRow | null {
  const updates: string[] = []
  const params: (string | number | null)[] = []
  if (patch.name !== undefined) {
    updates.push("name = ?")
    params.push(patch.name)
  }
  if (patch.visibility !== undefined) {
    updates.push("visibility = ?")
    params.push(patch.visibility)
  }
  if (patch.expiresAt !== undefined) {
    updates.push("expires_at = ?")
    params.push(patch.expiresAt)
  }
  if (patch.retentionHours !== undefined) {
    updates.push("retention_hours = ?")
    params.push(patch.retentionHours)
  }
  if (patch.retentionSource !== undefined) {
    updates.push("retention_source = ?")
    params.push(patch.retentionSource)
  }
  if (updates.length === 0) return getFileById(id)
  updates.push("updated_at = ?")
  params.push(now(), id)
  db.query(`UPDATE files SET ${updates.join(", ")} WHERE id = ?`).run(...params)
  return getFileById(id)
}

export function deleteFileRow(id: string): void {
  removeFile.run(id)
}

/** Storage shown to the user: only completed uploads count as used space. */
export function getUsage(userId: string): number {
  const row = selectReadyUsage.get(userId) as { used: number }
  return Number(row.used) || 0
}

/**
 * Storage reserved for quota enforcement: in-flight uploads reserve space so
 * two concurrent uploads cannot both pass the quota check.
 */
export function getReservedUsage(userId: string): number {
  const row = selectReservedUsage.get(userId) as { used: number }
  return Number(row.used) || 0
}

export function getFileCount(userId: string): number {
  const row = selectReadyCount.get(userId) as { count: number }
  return Number(row.count) || 0
}

export function getExpiringCount(userId: string, withinMs = 24 * 60 * 60 * 1000): number {
  const row = selectExpiring.get(userId, now() + withinMs) as { count: number }
  return Number(row.count) || 0
}

export function getGlobalUsage(): { used: number; count: number } {
  const used = selectAllUsage.get() as { used: number }
  const count = selectAllCount.get() as { count: number }
  return { used: Number(used.used) || 0, count: Number(count.count) || 0 }
}

export function getExpiringGlobalCount(withinMs = 7 * 24 * 60 * 60 * 1000): number {
  const row = selectExpiringAll.get(now() + withinMs) as { count: number }
  return Number(row.count) || 0
}

export function getPendingCount(): number {
  const row = selectPendingAll.get() as { count: number }
  return Number(row.count) || 0
}

export function getTotalDownloads(): number {
  const row = selectDownloads.get() as { count: number }
  return Number(row.count) || 0
}

export function getStalePendingFiles(cutoff: number, limit = 100): FileRow[] {
  return selectStalePending.all(cutoff, limit) as FileRow[]
}

export function getExpiredFiles(limit = 100): FileRow[] {
  return selectExpired.all(now(), limit) as FileRow[]
}

export function recordDownload(id: string): void {
  touchDownload.run(now(), id)
}

export interface ListFilesOptions {
  userId?: string
  search?: string
  type?: string
  sort?: string
  page?: number
  limit?: number
  expiring?: boolean
  visibility?: string
}

export function listFiles(options: ListFilesOptions = {}) {
  const page = Math.max(options.page ?? 1, 1)
  const limit = Math.min(Math.max(options.limit ?? 40, 1), 100)
  const offset = (page - 1) * limit
  const where: string[] = ["f.status = 'ready'"]
  const params: (string | number | null)[] = []

  if (options.userId) {
    where.push("f.user_id = ?")
    params.push(options.userId)
  }
  if (options.search) {
    where.push("(f.name LIKE ? OR f.mime LIKE ?)")
    const q = `%${options.search}%`
    params.push(q, q)
  }
  if (options.type && options.type !== "all") {
    if (options.type === "image") where.push("f.mime LIKE 'image/%'")
    else if (options.type === "video") where.push("f.mime LIKE 'video/%'")
    else if (options.type === "audio") where.push("f.mime LIKE 'audio/%'")
    else if (options.type === "document") where.push("(f.mime LIKE 'application/pdf%' OR f.mime LIKE 'text/%' OR f.mime LIKE 'application/vnd.openxmlformats%')")
    else if (options.type === "archive") where.push("(f.mime LIKE 'application/zip%' OR f.mime LIKE 'application/x-tar%' OR f.mime LIKE 'application/x-7z%')")
  }
  if (options.expiring) {
    where.push("f.expires_at IS NOT NULL AND f.expires_at <= ?")
    params.push(now() + 7 * 24 * 60 * 60 * 1000)
  }
  if (options.visibility && options.visibility !== "all") {
    where.push("f.visibility = ?")
    params.push(options.visibility)
  }

  const sort = options.sort || "newest"
  const orderBy =
    sort === "oldest" ? "f.created_at ASC" :
    sort === "name" ? "lower(f.name) ASC" :
    sort === "size" ? "f.size DESC" :
    sort === "expires" ? "f.expires_at IS NULL, f.expires_at ASC" :
    "f.created_at DESC"

  const clause = `WHERE ${where.join(" AND ")}`
  const rows = db
    .query(
      `SELECT f.*, u.name AS owner_name, u.email AS owner_email
       FROM files f JOIN users u ON u.id = f.user_id
       ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as FileRow[]
  const total = db
    .query(`SELECT COUNT(*) AS count FROM files f ${clause}`)
    .get(...params) as { count: number }

  return { files: rows, total: Number(total.count), page, limit }
}
