export type Visibility = "unlisted" | "private"

export interface User {
  id: string
  email: string
  name: string
  picture: string | null
  role: string
  isAdmin: boolean
  quotaBytes: number | null
  maxUploadBytes: number | null
  retentionHours: number | null
  createdAt: number
}

export interface FileOwner {
  id: string
  name: string
  email: string
}

export interface FileItem {
  id: string
  name: string
  mime: string
  size: number
  visibility: Visibility
  status: "pending" | "ready"
  url: string | null
  downloadUrl: string
  expiresAt: number | null
  retentionHours: number | null
  retentionSource: string
  retentionLabel: string
  downloads: number
  createdAt: number
  updatedAt: number
  owner?: FileOwner
}

export interface QuotaState {
  used: number
  quota: number | null
  unlimited: boolean
  percent: number
  remaining: number | null
}

export interface FileDefaults {
  visibility: Visibility
  largeFileThresholdBytes: number
  largeFileRetentionHours: number
  defaultRetentionHours: number
}

export interface FileStats {
  storage: QuotaState
  files: number
  expiringSoon: number
  maxUploadBytes: number | null
  defaults: FileDefaults
}

export interface FilesResponse {
  files: FileItem[]
  total: number
  page: number
  limit: number
}

export interface UploadIntent {
  id: string
  mode: "presigned" | "proxy"
  expiresAt: number
  upload: {
    method: "PUT"
    url: string
    headers: Record<string, string>
    expiresIn?: number
  }
}

export interface UploadIntentResponse {
  file: FileItem
  intent: UploadIntent
}

export interface TokenRecord {
  id: string
  name: string
  prefix: string
  scopes: string[]
  lastUsedAt: number | null
  expiresAt: number | null
  createdAt: number
}

export interface AdminOverview {
  storage: {
    used: number
    files: number
    pending: number
    expiring: number
    downloads: number
  }
  users: { total: number; admins: number }
  settings: GlobalSettings
  driver: { name: string; supportsPresigned: boolean; supportsSignedGet: boolean }
  retention: { presets: number[]; minHours: number }
  recentAudit: AuditEntry[]
}

export interface GlobalSettings {
  defaultQuotaBytes: number
  maxUploadBytes: number
  largeFileThresholdBytes: number
  largeFileRetentionHours: number
  defaultRetentionHours: number
  defaultVisibility: Visibility
  blockedMimeTypes: string
}

export interface AdminUser extends User {
  usage: {
    used: number
    files: number
    quota: number | null
    maxUploadBytes: number | null
  }
}

export interface AdminUsersResponse {
  users: AdminUser[]
  total: number
  page: number
  limit: number
}

export interface AdminUserDetail {
  user: User
  storage: QuotaState
  files: number
  expiringSoon: number
  limits: {
    quotaBytes: number | null
    maxUploadBytes: number | null
    retentionHours: number | null
    retentionLabel: string
    effectiveMaxUploadBytes: number | null
  }
}

export interface AuditEntry {
  id: string
  actorId: string | null
  actorEmail: string | null
  action: string
  targetType: string | null
  targetId: string | null
  meta: Record<string, unknown> | null
  ip: string | null
  ua: string | null
  createdAt: number
}

export interface RuntimeConfig {
  appUrl: string
  driver: string
  uploadMode: "presigned" | "proxy"
  supportsPresigned: boolean
  defaults: {
    quotaBytes: number
    maxUploadBytes: number
    largeFileThresholdBytes: number
    largeFileRetentionHours: number
    defaultRetentionHours: number
    defaultVisibility: Visibility
  }
  retention: {
    minHours: number
    presets: number[]
    largeFileThresholdBytes: number
    largeFileRetentionHours: number
  }
  blockedMimeTypes: string[]
  adminSessionTtlMinutes: number
}