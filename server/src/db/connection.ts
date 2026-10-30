/**
 * SQLite connection. The schema is applied at module load so any module that
 * imports `db` can prepare statements immediately.
 */

import { Database } from "bun:sqlite"
import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import config from "../config.js"

mkdirSync(config.dataDir, { recursive: true })

export const db = new Database(path.join(config.dataDir, "voidcdn.db"))
db.exec("PRAGMA journal_mode = WAL;")
db.exec("PRAGMA foreign_keys = ON;")

const schema = readFileSync(path.join(import.meta.dir, "schema.sql"), "utf8")
db.exec(schema)

// Visibility model: "public" was retired. Anything stored before the change
// becomes a link-only (unlisted) file.
db.exec("UPDATE files SET visibility = 'unlisted' WHERE visibility = 'public'")
db.exec("UPDATE settings SET value = 'unlisted' WHERE key = 'defaultVisibility' AND value = 'public'")

export function now(): number {
  return Date.now()
}

export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE")
  try {
    const result = fn()
    db.exec("COMMIT")
    return result
  } catch (err) {
    try {
      db.exec("ROLLBACK")
    } catch {
      /* ignore */
    }
    throw err
  }
}
