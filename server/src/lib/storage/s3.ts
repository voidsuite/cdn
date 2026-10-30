import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import config from "../../config.js"
import type { HeadResult, PresignedUpload, PutOptions, ReadResult, StorageDriver } from "./types.js"

export class S3Driver implements StorageDriver {
  readonly name = "s3" as const
  readonly supportsPresign = true
  readonly supportsSignedGet = true
  private client: S3Client
  private bucket: string
  private publicBase: string

  constructor() {
    const c = config.storage.s3
    this.bucket = c.bucket
    this.publicBase = c.publicBaseUrl
    this.client = new S3Client({
      region: c.region,
      endpoint: c.endpoint || undefined,
      forcePathStyle: c.forcePathStyle,
      credentials: {
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
      },
    })
  }

  async createUploadUrl(key: string, options: PutOptions): Promise<PresignedUpload | null> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
      ContentLength: options.contentLength,
      CacheControl: options.cacheControl,
      ContentDisposition: options.contentDisposition,
      Metadata: options.metadata,
    })
    const url = await getSignedUrl(this.client, command, { expiresIn: 15 * 60 })
    return {
      url,
      method: "PUT",
      headers: { "Content-Type": options.contentType },
      expiresIn: 15 * 60,
    }
  }

  async put(key: string, body: ReadableStream<Uint8Array>, options: PutOptions) {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body as unknown as import("@aws-sdk/client-s3").PutObjectCommandInput["Body"],
        ContentType: options.contentType,
        ContentLength: options.contentLength,
        CacheControl: options.cacheControl,
        ContentDisposition: options.contentDisposition,
        Metadata: options.metadata,
      })
    )
    return { etag: result.ETag }
  }

  async head(key: string): Promise<HeadResult | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return {
        size: Number(result.ContentLength || 0),
        etag: result.ETag,
        contentType: result.ContentType,
      }
    } catch {
      return null
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async deleteMany(items: { key: string }[]): Promise<void> {
    for (let i = 0; i < items.length; i += 1000) {
      const chunk = items.slice(i, i + 1000)
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((item) => ({ Key: item.key })) },
        })
      )
    }
  }

  publicUrl(key: string): string | null {
    if (!this.publicBase) return null
    return `${this.publicBase}/${key.replace(/^\/+/, "")}`
  }

  async signedGetUrl(
    key: string,
    ttlSeconds: number,
    _zone?: string,
    downloadName?: string
  ): Promise<string | null> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: downloadName
        ? `attachment; filename="${downloadName.replace(/["\\]/g, "")}"`
        : undefined,
    })
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds })
  }

  async getStream(key: string): Promise<ReadResult | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      const body = result.Body
      if (!body) return null
      const stream = "transformToWebStream" in body
        ? body.transformToWebStream()
        : (body as ReadableStream<Uint8Array>)
      return { stream, contentLength: result.ContentLength }
    } catch {
      return null
    }
  }
}
