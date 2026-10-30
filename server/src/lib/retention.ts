import type { StoredUser } from "../db/users.js"
import type { Settings } from "../db/settings.js"

export interface RetentionResult {
  hours: number | null
  expiresAt: number | null
  source: "auto" | "auto_large" | "user" | "admin" | "unlimited"
}

/** `-1` / 0 / null all mean "unlimited" in policy fields. */
function policyHours(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (value <= 0) return null
  if (value < 24) return 24
  return value
}

export function resolveRetention(opts: {
  size: number
  user: StoredUser
  settings: Settings
  adminRetentionHours?: number | null
  now?: number
}): RetentionResult {
  const base = opts.now ?? Date.now()

  if (opts.adminRetentionHours !== undefined) {
    const hours = policyHours(opts.adminRetentionHours)
    if (hours === null) return { hours: null, expiresAt: null, source: "unlimited" }
    return { hours, expiresAt: base + hours * 60 * 60 * 1000, source: "admin" }
  }

  const large = opts.size > opts.settings.largeFileThresholdBytes
  const inherited = large
    ? opts.settings.largeFileRetentionHours
    : opts.settings.defaultRetentionHours

  // A per-user override always wins over the global default.
  if (opts.user.retention_hours !== null && opts.user.retention_hours !== undefined) {
    const hours = policyHours(opts.user.retention_hours)
    if (hours === null) return { hours: null, expiresAt: null, source: "unlimited" }
    return { hours, expiresAt: base + hours * 60 * 60 * 1000, source: "user" }
  }

  const hours = policyHours(inherited)
  if (hours === null) return { hours: null, expiresAt: null, source: "unlimited" }
  return {
    hours,
    expiresAt: base + hours * 60 * 60 * 1000,
    source: large ? "auto_large" : "auto",
  }
}

export function retentionLabel(hours: number | null): string {
  if (hours === null || hours <= 0) return "Unlimited"
  if (hours < 48) return `${hours} hours`
  if (hours < 24 * 14) return `${Math.round(hours / 24)} days`
  if (hours < 24 * 60) return `${Math.round(hours / 24 / 7)} weeks`
  if (hours < 24 * 365) return `${Math.round(hours / 24 / 30)} months`
  return `${Math.round(hours / 24 / 365)} years`
}
