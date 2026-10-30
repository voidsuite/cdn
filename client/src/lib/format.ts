export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes === null || bytes === undefined) return "Unlimited"
  if (!Number.isFinite(bytes) || bytes < 0) return "Unlimited"
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, exponent)
  const digits = exponent === 0 ? 0 : value >= 100 ? 0 : decimals
  return `${value.toFixed(digits)} ${units[exponent]}`
}

export function formatDate(ts: number | null | undefined): string {
  if (!ts) return "—"
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return "—"
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return "—"
  const diff = ts - Date.now()
  const abs = Math.abs(diff)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 60 * 60 * 1000],
    ["month", 30 * 24 * 60 * 60 * 1000],
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000],
  ]
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "minute") {
      return formatter.format(Math.round(diff / ms), unit)
    }
  }
  return "just now"
}

export function expiryLabel(ts: number | null | undefined): string {
  if (!ts) return "Never expires"
  if (ts <= Date.now()) return "Expired"
  return `Expires ${relativeTime(ts)}`
}

export function retentionText(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || hours <= 0) return "Unlimited"
  if (hours < 48) return `${hours} hours`
  if (hours < 24 * 14) return `${Math.round(hours / 24)} days`
  if (hours < 24 * 60) return `${Math.round(hours / 24 / 7)} weeks`
  if (hours < 24 * 365) return `${Math.round(hours / 24 / 30)} months`
  return `${Math.round(hours / 24 / 365)} years`
}

export function initials(name: string | null | undefined, fallback = "?"): string {
  const value = (name || "").trim()
  if (!value) return fallback
  const parts = value.split(/\s+/)
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

export function fileKind(mime: string, name = ""): "image" | "video" | "audio" | "pdf" | "archive" | "code" | "doc" | "file" {
  const type = (mime || "").toLowerCase()
  if (type.startsWith("image/")) return "image"
  if (type.startsWith("video/")) return "video"
  if (type.startsWith("audio/")) return "audio"
  if (type === "application/pdf" || name.toLowerCase().endsWith(".pdf")) return "pdf"
  if (type.includes("zip") || type.includes("tar") || type.includes("7z") || type.includes("rar")) return "archive"
  if (type.startsWith("text/") || type.includes("json") || type.includes("javascript")) return "code"
  if (type.includes("word") || type.includes("document") || type.includes("sheet") || type.includes("presentation")) return "doc"
  return "file"
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return ""
  return name.slice(dot + 1).toUpperCase().slice(0, 5)
}