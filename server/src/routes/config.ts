/**
 * /api/config — public, safe-to-expose runtime configuration for the UI.
 */

import { Hono } from "hono"
import config from "../config.js"
import { getSettings } from "../db/settings.js"
import { blockedMimeList, storage, uploadModeForDriver } from "../lib/storage/index.js"

const configRoutes = new Hono()

configRoutes.get("/config", (c) => {
  const settings = getSettings()
  return c.json({
    appUrl: config.appUrl,
    shortener: { url: config.voidUrl },
    driver: storage.name,
    uploadMode: uploadModeForDriver(),
    supportsPresigned: storage.supportsPresign,
    defaults: {
      quotaBytes: settings.defaultQuotaBytes,
      maxUploadBytes: settings.maxUploadBytes,
      largeFileThresholdBytes: settings.largeFileThresholdBytes,
      largeFileRetentionHours: settings.largeFileRetentionHours,
      defaultRetentionHours: settings.defaultRetentionHours,
      defaultVisibility: settings.defaultVisibility,
    },
    retention: {
      minHours: config.retention.minHours,
      presets: config.retention.presets,
      largeFileThresholdBytes: settings.largeFileThresholdBytes,
      largeFileRetentionHours: settings.largeFileRetentionHours,
    },
    blockedMimeTypes: blockedMimeList(),
    adminSessionTtlMinutes: config.adminSessionTtlMinutes,
  })
})

export default configRoutes
