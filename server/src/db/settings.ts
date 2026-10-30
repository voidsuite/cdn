import { db, now } from "./connection.js"
import config from "../config.js"
import type { Visibility } from "./files.js"

export interface Settings {
  defaultQuotaBytes: number
  maxUploadBytes: number
  largeFileThresholdBytes: number
  largeFileRetentionHours: number
  defaultRetentionHours: number
  defaultVisibility: Visibility
  blockedMimeTypes: string
}

const DEFAULTS: Record<string, string> = {
  defaultQuotaBytes: String(config.defaults.quotaBytes),
  maxUploadBytes: String(config.defaults.maxUploadBytes),
  largeFileThresholdBytes: String(config.defaults.largeFileThresholdBytes),
  largeFileRetentionHours: String(config.defaults.largeFileRetentionHours),
  defaultRetentionHours: String(config.defaults.defaultRetentionHours),
  defaultVisibility: config.defaults.defaultVisibility,
  blockedMimeTypes: config.defaults.blockedMimeTypes,
}

const upsert = db.query(`
  INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`)
const selectOne = db.query("SELECT value FROM settings WHERE key = ?")
const selectAll = db.query("SELECT key, value FROM settings")
const updateOne = db.query("UPDATE settings SET value = ?, updated_at = ? WHERE key = ?")

// Seed missing defaults once; existing admin changes are kept.
for (const [key, value] of Object.entries(DEFAULTS)) {
  if (!selectOne.get(key)) upsert.run(key, value, now())
}

export function getSetting(key: string): string | null {
  const row = selectOne.get(key) as { value: string } | null
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  updateOne.run(value, now(), key)
}

export function getSettings(): Settings {
  const rows = selectAll.all() as { key: string; value: string }[]
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const num = (key: string) => Number(map[key] ?? DEFAULTS[key] ?? 0)
  const visibility = map.defaultVisibility
  return {
    defaultQuotaBytes: num("defaultQuotaBytes"),
    maxUploadBytes: num("maxUploadBytes"),
    largeFileThresholdBytes: num("largeFileThresholdBytes"),
    largeFileRetentionHours: num("largeFileRetentionHours"),
    defaultRetentionHours: num("defaultRetentionHours"),
    // "public" is retired; treat any legacy value as unlisted.
    defaultVisibility: visibility === "private" ? "private" : "unlisted",
    blockedMimeTypes: map.blockedMimeTypes ?? DEFAULTS.blockedMimeTypes,
  }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (!(key in DEFAULTS)) continue
    upsert.run(key, String(value), now())
  }
  return getSettings()
}

export function defaultSettings(): Record<string, string> {
  return { ...DEFAULTS }
}
