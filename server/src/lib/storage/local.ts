import { createWriteStream, mkdirSync } from "node:fs"
import { stat, unlink } from "node:fs/promises"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import path from "node:path"
import config from "../../config.js"
import type { HeadResult, PresignedUpload, PutOptions, ReadResult, StorageDriver } from "./types.js"

export class LocalDriver implements StorageDriver {
  readonly name = "local" as const
  readonly supportsPresign = false
  readonly supportsSignedGet = false
  private root: string

  constructor() {
    this.root = path.resolve(config.storage.localDir)
    mkdirSync(this.root, { recursive: true })
  }

  private filePath(key: string): string {
    const resolved = path.resolve(this.root, key.replace(/^\/+/, ""))
    if (!resolved.startsWith(this.root + path.sep) && resolved !== this.root) {
      throw new Error("Invalid storage key")
    }
    return resolved
  }

  async createUploadUrl(): Promise<PresignedUpload | null> {
    return null
  }

  async put(key: string, body: ReadableStream<Uint8Array>, _options: PutOptions) {
    const target = this.filePath(key)
    mkdirSync(path.dirname(target), { recursive: true })
    await pipeline(Readable.fromWeb(body as never), createWriteStream(target))
    return {}
  }

  async head(key: string): Promise<HeadResult | null> {
    try {
      const info = await stat(this.filePath(key))
      return { size: info.size }
    } catch {
      return null
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.filePath(key))
    } catch {
      /* already gone */
    }
  }

  async deleteMany(items: { key: string }[]): Promise<void> {
    await Promise.allSettled(items.map((item) => this.delete(item.key)))
  }

  publicUrl(key: string): string | null {
    return `/f/${key.replace(/^\/+/, "")}`
  }

  async signedGetUrl(): Promise<string | null> {
    return null
  }

  async getStream(key: string): Promise<ReadResult | null> {
    const file = Bun.file(this.filePath(key))
    if (!(await file.exists())) return null
    return { stream: file.stream() as ReadableStream<Uint8Array>, contentLength: file.size }
  }
}
