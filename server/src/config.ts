/**
 * Void CDN configuration — env driven only. Secrets never reach the browser.
 */

const int = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value || "", 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const bool = (value: string | undefined, fallback = false) =>
  value === undefined ? fallback : ["1", "true", "yes", "on"].includes(value.toLowerCase())

const trim = (value: string | undefined) => (value || "").trim()

const GiB = 1024 * 1024 * 1024
const MiB = 1024 * 1024

export type StorageDriverName = "local" | "s3" | "bunny"
export type UploadMode = "auto" | "presigned" | "proxy"

const config = {
  port: int(process.env.PORT, 3007),
  appUrl: trim(process.env.APP_URL) || "http://localhost:5180",
  // Void Links (URL shortener) used by the "Shorten link" file action.
  voidUrl: (trim(process.env.VOIDURL_URL) || "https://url.voidsuite.cc").replace(/\/+$/, ""),
  voidauthUrl: (trim(process.env.VOIDAUTH_URL) || "https://auth.stwupid.tech").replace(/\/+$/, ""),
  clientId: trim(process.env.VOIDCDN_CLIENT_ID) || "voidcdn",
  clientSecret: trim(process.env.VOIDCDN_CLIENT_SECRET),
  /**
   * Scopes requested at login. Drop `role` until the VoidAuth deployment
   * advertises it; `CDN_ADMIN_EMAILS` is the fallback admin check meanwhile.
   */
  oauthScopes: trim(process.env.VOIDAUTH_SCOPES) || "openid profile email read write role",
  allowedOrigins: trim(process.env.ALLOWED_ORIGINS)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  dataDir: trim(process.env.DATA_DIR) || "./data",
  sessionCookie: "voidcdn_sid",
  adminCookie: "voidcdn_admin",
  adminSessionTtlMinutes: int(process.env.ADMIN_SESSION_TTL_MINUTES, 30),
  upload: {
    /**
     * Bun rejects request bodies larger than this before the route runs
     * (default 128 MiB). The real per-file limit comes from settings/quota;
     * this cap only needs to exceed the largest upload the app may allow.
     * Streamed uploads are not buffered, so a generous cap is safe.
     */
    maxRequestBodyBytes: Math.max(int(process.env.MAX_REQUEST_BODY_BYTES, 8 * GiB), 2 * GiB),
  },
  /** Optional fallback when VoidAuth does not return a role claim. */
  adminEmails: trim(process.env.CDN_ADMIN_EMAILS)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  storage: {
    driver: (trim(process.env.STORAGE_DRIVER) || "local") as StorageDriverName,
    uploadMode: (trim(process.env.UPLOAD_MODE) || "auto") as UploadMode,
    publicBaseUrl: (trim(process.env.CDN_PUBLIC_BASE_URL) || "").replace(/\/+$/, ""),
    prefix: (trim(process.env.STORAGE_PREFIX) || "u").replace(/^\/+|\/+$/g, ""),
    localDir: trim(process.env.LOCAL_STORAGE_DIR) || "./data/blobs",
    s3: {
      endpoint: trim(process.env.S3_ENDPOINT),
      region: trim(process.env.S3_REGION) || "auto",
      bucket: trim(process.env.S3_BUCKET),
      accessKeyId: trim(process.env.S3_ACCESS_KEY_ID),
      secretAccessKey: trim(process.env.S3_SECRET_ACCESS_KEY),
      forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, false),
      publicBaseUrl: (trim(process.env.S3_PUBLIC_BASE_URL) || "").replace(/\/+$/, ""),
    },
    bunny: {
      storageEndpoint: (trim(process.env.BUNNY_STORAGE_ENDPOINT) || "https://storage.bunnycdn.com").replace(/\/+$/, ""),
      zone: trim(process.env.BUNNY_STORAGE_ZONE),
      password: trim(process.env.BUNNY_STORAGE_PASSWORD),
      publicZone: trim(process.env.BUNNY_PUBLIC_STORAGE_ZONE),
      privateZone: trim(process.env.BUNNY_PRIVATE_STORAGE_ZONE),
      cdnBaseUrl: (trim(process.env.BUNNY_CDN_BASE_URL) || "").replace(/\/+$/, ""),
      tokenAuthKey: trim(process.env.BUNNY_TOKEN_AUTH_KEY),
    },
  },
  defaults: {
    quotaBytes: int(process.env.DEFAULT_QUOTA_BYTES, GiB),
    maxUploadBytes: int(process.env.MAX_UPLOAD_BYTES, GiB),
    largeFileThresholdBytes: int(process.env.LARGE_FILE_THRESHOLD_BYTES, 50 * MiB),
    largeFileRetentionHours: int(process.env.LARGE_FILE_RETENTION_HOURS, 24 * 7),
    defaultRetentionHours: int(process.env.DEFAULT_RETENTION_HOURS, 0),
    defaultVisibility: (trim(process.env.DEFAULT_VISIBILITY) === "private" ? "private" : "unlisted") as
      | "unlisted"
      | "private",
    blockedMimeTypes: trim(process.env.BLOCKED_MIME_TYPES) ||
      "image/svg+xml,text/html,application/xhtml+xml,application/javascript,text/javascript,application/x-javascript",
  },
  retention: {
    minHours: 24,
    presets: [24, 48, 72, 168, 336, 720, 2160, 4320, 8760],
  },
} as const

export function isSecure(): boolean {
  return config.appUrl.startsWith("https://")
}

export default config
