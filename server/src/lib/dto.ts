import config from "../config.js"
import type { StoredUser } from "../db/users.js"
import type { FileRow } from "../db/files.js"
import { retentionLabel } from "./retention.js"
import { storage } from "./storage/index.js"

export function userDto(user: StoredUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    role: user.role,
    isAdmin: user.is_admin === 1,
    quotaBytes: user.quota_bytes > 0 ? user.quota_bytes : null,
    maxUploadBytes: user.max_upload_bytes,
    retentionHours: user.retention_hours,
    createdAt: user.created_at,
  }
}

export async function fileDto(file: FileRow) {
  const url = await fileUrl(file)
  return {
    id: file.id,
    name: file.name,
    mime: file.mime,
    size: file.size,
    visibility: file.visibility,
    status: file.status,
    url,
    downloadUrl: `/api/files/${file.id}/download?download=1`,
    expiresAt: file.expires_at,
    retentionHours: file.retention_hours,
    retentionSource: file.retention_source,
    retentionLabel: retentionLabel(file.retention_hours),
    downloads: file.downloads,
    createdAt: file.created_at,
    updatedAt: file.updated_at,
    owner: file.owner_name
      ? { id: file.user_id, name: file.owner_name, email: file.owner_email || "" }
      : undefined,
  }
}

export async function fileUrl(file: FileRow): Promise<string | null> {
  // Private files are never exposed through a pull zone; the gateway checks
  // ownership (or admin) on every request.
  if (file.visibility === "private") {
    return `/api/files/${file.id}/download`
  }

  // Public links on Bunny with token auth enabled are signed with a long TTL.
  if (storage.name === "bunny" && config.storage.bunny.tokenAuthKey) {
    const signed = await storage.signedGetUrl(file.key, 365 * 24 * 60 * 60, file.storage_zone as never)
    if (signed) return signed
  }

  return storage.publicUrl(file.key, file.storage_zone as never) || `/f/${file.key}`
}
