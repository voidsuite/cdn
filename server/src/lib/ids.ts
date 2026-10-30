import { randomBytes, randomUUID, createHash } from "node:crypto"

export function uuid(): string {
  return randomUUID()
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function tokenPrefix(token: string): string {
  return token.slice(0, 12)
}
