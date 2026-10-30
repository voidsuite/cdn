import type { StoredUser } from "../db/users.js"
import type { Settings } from "../db/settings.js"

export function effectiveQuota(user: StoredUser, settings: Settings): number {
  const quota = user.quota_bytes ?? settings.defaultQuotaBytes
  if (quota <= 0) return Number.POSITIVE_INFINITY
  return quota
}

export function effectiveMaxUpload(user: StoredUser, settings: Settings): number {
  const max = user.max_upload_bytes ?? settings.maxUploadBytes
  if (max <= 0) return Number.POSITIVE_INFINITY
  return max
}

export function quotaState(user: StoredUser, settings: Settings, used: number) {
  const quota = effectiveQuota(user, settings)
  const unlimited = quota === Number.POSITIVE_INFINITY
  return {
    used,
    quota: unlimited ? null : quota,
    unlimited,
    percent: unlimited ? 0 : Math.min(100, Math.round((used / quota) * 100)),
    remaining: unlimited ? null : Math.max(0, quota - used),
  }
}

export function canStore(
  user: StoredUser,
  settings: Settings,
  used: number,
  size: number
): { ok: true } | { ok: false; error: string } {
  const max = effectiveMaxUpload(user, settings)
  if (size > max) {
    return { ok: false, error: `File is larger than the ${formatGiB(max)} per-file limit.` }
  }
  const quota = effectiveQuota(user, settings)
  if (quota !== Number.POSITIVE_INFINITY && used + size > quota) {
    return { ok: false, error: "Storage quota exceeded. Delete some files or ask an admin for more space." }
  }
  return { ok: true }
}

function formatGiB(bytes: number): string {
  if (bytes === Number.POSITIVE_INFINITY) return "unlimited"
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  return `${Math.round(bytes / (1024 * 1024))} MB`
}
