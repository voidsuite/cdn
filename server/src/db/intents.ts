import { db, now } from "./connection.js"

export interface UploadIntent {
  id: string
  file_id: string
  user_id: string
  key: string
  size: number
  mime: string
  mode: "presigned" | "proxy"
  storage_zone: string
  expires_at: number
  created_at: number
}

const insert = db.query(`
  INSERT INTO upload_intents (id, file_id, user_id, key, size, mime, mode, storage_zone, expires_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const selectByFile = db.query("SELECT * FROM upload_intents WHERE file_id = ?")
const selectById = db.query("SELECT * FROM upload_intents WHERE id = ?")
const removeByFile = db.query("DELETE FROM upload_intents WHERE file_id = ?")
const selectExpired = db.query("SELECT * FROM upload_intents WHERE expires_at <= ? LIMIT ?")

export function createIntent(intent: Omit<UploadIntent, "created_at">): UploadIntent {
  insert.run(
    intent.id,
    intent.file_id,
    intent.user_id,
    intent.key,
    intent.size,
    intent.mime,
    intent.mode,
    intent.storage_zone,
    intent.expires_at,
    now()
  )
  return selectById.get(intent.id) as UploadIntent
}

export function getIntentByFile(fileId: string): UploadIntent | null {
  return (selectByFile.get(fileId) as UploadIntent | null) ?? null
}

export function deleteIntentByFile(fileId: string): void {
  removeByFile.run(fileId)
}

export function getExpiredIntents(limit = 100): UploadIntent[] {
  return selectExpired.all(now(), limit) as UploadIntent[]
}
