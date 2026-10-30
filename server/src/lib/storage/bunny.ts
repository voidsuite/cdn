import { createHmac } from "node:crypto"
import config from "../../config.js"
import type { HeadResult, PresignedUpload, PutOptions, ReadResult, StorageDriver, StorageZone } from "./types.js"

/**
 * Bunny Storage native HTTP API (not the S3 preview).
 * Uploads are proxied through the gateway; downloads use the connected pull
 * zone. Private objects can live in a separate zone that has no public pull
 * zone, or be served through the app proxy.
 */
export class BunnyDriver implements StorageDriver {
  readonly name = "bunny" as const
  readonly supportsPresign = false
  readonly supportsSignedGet = true

  private endpoint = config.storage.bunny.storageEndpoint
  private zone = config.storage.bunny.zone
  private password = config.storage.bunny.password
  private publicZone = config.storage.bunny.publicZone
  private privateZone = config.storage.bunny.privateZone
  private cdnBaseUrl = config.storage.bunny.cdnBaseUrl
  private tokenKey = config.storage.bunny.tokenAuthKey

  private zoneName(zone?: StorageZone): string {
    if (zone === "private" && this.privateZone) return this.privateZone
    if (zone === "public" && this.publicZone) return this.publicZone
    return this.zone
  }

  private objectUrl(key: string, zone?: StorageZone): string {
    const clean = key.replace(/^\/+/, "")
    return `${this.endpoint}/${this.zoneName(zone)}/${clean}`
  }

  async createUploadUrl(): Promise<PresignedUpload | null> {
    return null
  }

  async put(key: string, body: ReadableStream<Uint8Array>, options: PutOptions) {
    const headers: Record<string, string> = {
      AccessKey: this.password,
      "Content-Type": options.contentType,
      "Cache-Control": options.cacheControl || "public, max-age=31536000, immutable",
    }
    if (options.contentDisposition) headers["Content-Disposition"] = options.contentDisposition
    if (options.contentLength !== undefined) headers["Content-Length"] = String(options.contentLength)

    const res = await fetch(this.objectUrl(key, options.zone), {
      method: "PUT",
      headers,
      body,
      // Never leave a failed upload hanging forever; a timeout rejects, the
      // route discards the pending row, and the quota reservation is freed.
      signal: AbortSignal.timeout(5 * 60 * 1000),
      // Bun accepts streaming bodies without Node's duplex option; the cast
      // keeps TypeScript happy across runtimes.
      duplex: "half",
    } as RequestInit)
    if (!res.ok) {
      throw new Error(`Bunny upload failed: ${res.status} ${await res.text().catch(() => "")}`)
    }
    return { etag: res.headers.get("etag") || undefined }
  }

  async head(key: string, zone?: StorageZone): Promise<HeadResult | null> {
    const res = await fetch(this.objectUrl(key, zone), {
      method: "HEAD",
      headers: { AccessKey: this.password },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null
    return {
      size: Number(res.headers.get("content-length") || 0),
      etag: res.headers.get("etag") || undefined,
      contentType: res.headers.get("content-type") || undefined,
    }
  }

  async delete(key: string, zone?: StorageZone): Promise<void> {
    await fetch(this.objectUrl(key, zone), {
      method: "DELETE",
      headers: { AccessKey: this.password },
      signal: AbortSignal.timeout(20_000),
    })
  }

  async deleteMany(items: { key: string; zone?: StorageZone }[]): Promise<void> {
    await Promise.allSettled(items.map((item) => this.delete(item.key, item.zone)))
  }

  publicUrl(key: string, zone?: StorageZone): string | null {
    if (zone === "private" || !this.cdnBaseUrl) return null
    return `${this.cdnBaseUrl}/${key.replace(/^\/+/, "")}`
  }

  /**
   * Advanced token authentication (HMAC-SHA256). Enable "Token Authentication"
   * on the pull zone and set BUNNY_TOKEN_AUTH_KEY. If it is not enabled, this
   * returns null and the caller falls back to the app proxy.
   */
  async signedGetUrl(key: string, ttlSeconds: number, zone?: StorageZone): Promise<string | null> {
    if (zone === "private" && this.privateZone && this.privateZone !== this.publicZone) return null
    if (!this.cdnBaseUrl || !this.tokenKey) return null
    const path = `/${key.replace(/^\/+/, "")}`
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds
    const signature = createHmac("sha256", this.tokenKey).update(path + expires).digest("base64url")
    return `${this.cdnBaseUrl}${path}?token=HS256-${signature}&expires=${expires}`
  }

  async getStream(key: string, zone?: StorageZone): Promise<ReadResult | null> {
    const res = await fetch(this.objectUrl(key, zone), {
      headers: { AccessKey: this.password },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok || !res.body) return null
    return {
      stream: res.body as ReadableStream<Uint8Array>,
      contentLength: Number(res.headers.get("content-length") || 0) || undefined,
    }
  }
}
