/**
 * Retention sweeper. Runs every five minutes and removes:
 *   - files past their retention deadline
 *   - expired upload intents
 *   - abandoned pending uploads older than two hours
 */

import { deleteFileRow, getExpiredFiles, getFileById, getStalePendingFiles } from "../db/files.js"
import { deleteIntentByFile, getExpiredIntents } from "../db/intents.js"
import { audit } from "../db/audit.js"
import { storage, type StorageZone } from "../lib/storage/index.js"

// Upload intents live for one hour; the stale sweep is a backstop for rows
// that somehow outlive their intent. Abandoned uploads used to reserve quota
// for a whole day, which looked like phantom usage in the UI.
const STALE_PENDING_MS = 2 * 60 * 60 * 1000

export interface SweepResult {
  expired: number
  intents: number
  stale: number
  errors: number
}

export async function sweepOnce(): Promise<SweepResult> {
  const result: SweepResult = { expired: 0, intents: 0, stale: 0, errors: 0 }

  for (const file of getExpiredFiles(200)) {
    try {
      await storage.delete(file.key, file.storage_zone as StorageZone).catch(() => {})
      deleteIntentByFile(file.id)
      deleteFileRow(file.id)
      result.expired++
      audit({
        actorId: null,
        actorEmail: null,
        action: "file.expire",
        targetType: "file",
        targetId: file.id,
        meta: { name: file.name, owner: file.user_id, size: file.size },
      })
    } catch {
      result.errors++
    }
  }

  for (const intent of getExpiredIntents(200)) {
    try {
      // An expired intent means the upload never completed. Drop both the
      // intent and its pending file row (which otherwise keeps reserving
      // quota until the stale-pending sweep).
      const file = getFileById(intent.file_id)
      if (file && file.status === "pending") {
        await storage.delete(file.key, file.storage_zone as StorageZone).catch(() => {})
        deleteFileRow(file.id)
      }
      deleteIntentByFile(intent.file_id)
      result.intents++
    } catch {
      result.errors++
    }
  }

  const cutoff = Date.now() - STALE_PENDING_MS
  for (const file of getStalePendingFiles(cutoff, 200)) {
    try {
      await storage.delete(file.key, file.storage_zone as StorageZone).catch(() => {})
      deleteIntentByFile(file.id)
      deleteFileRow(file.id)
      result.stale++
      audit({
        actorId: null,
        actorEmail: null,
        action: "file.abandoned",
        targetType: "file",
        targetId: file.id,
        meta: { name: file.name, owner: file.user_id },
      })
    } catch {
      result.errors++
    }
  }

  return result
}

export function startSweeper(intervalMs = 5 * 60 * 1000): void {
  const run = () => {
    sweepOnce()
      .then((result) => {
        if (result.expired || result.intents || result.stale || result.errors) {
          console.log(
            `[sweeper] expired=${result.expired} intents=${result.intents} stale=${result.stale} errors=${result.errors}`
          )
        }
      })
      .catch((err) => console.error("[sweeper] failed", err))
  }
  const timer = setInterval(run, intervalMs)
  timer.unref?.()
  setTimeout(run, 10_000).unref?.()
}
