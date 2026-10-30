export type StorageZone = "default" | "public" | "private"

export interface PutOptions {
  contentType: string
  contentLength?: number
  metadata?: Record<string, string>
  cacheControl?: string
  contentDisposition?: string
  zone?: StorageZone
}

export interface PresignedUpload {
  url: string
  method: "PUT"
  headers: Record<string, string>
  expiresIn: number
}

export interface HeadResult {
  size: number
  etag?: string
  contentType?: string
}

export interface ReadResult {
  stream: ReadableStream<Uint8Array>
  contentLength?: number
}

export interface StorageDriver {
  readonly name: "local" | "s3" | "bunny"
  readonly supportsPresign: boolean
  readonly supportsSignedGet: boolean
  createUploadUrl(key: string, options: PutOptions): Promise<PresignedUpload | null>
  put(key: string, body: ReadableStream<Uint8Array>, options: PutOptions): Promise<{ etag?: string }>
  head(key: string, zone?: StorageZone): Promise<HeadResult | null>
  delete(key: string, zone?: StorageZone): Promise<void>
  deleteMany(items: { key: string; zone?: StorageZone }[]): Promise<void>
  publicUrl(key: string, zone?: StorageZone): string | null
  signedGetUrl(key: string, ttlSeconds: number, zone?: StorageZone, downloadName?: string): Promise<string | null>
  getStream(key: string, zone?: StorageZone): Promise<ReadResult | null>
}
