import { describe, expect, test } from "bun:test"
import { isBlockedMime, makeKey, objectName, safeExtension, sanitizeName } from "./index.js"

describe("object naming", () => {
  test("keeps the original name behind a random prefix", () => {
    expect(objectName("image.png")).toMatch(/^[0-9a-f]{12}_image\.png$/)
    expect(objectName("My Photo (1).png")).toMatch(/^[0-9a-f]{12}_My-Photo-1\.png$/)
    expect(objectName("report.final.pdf")).toMatch(/^[0-9a-f]{12}_report\.final\.pdf$/)
  })

  test("prefixes are unique per upload", () => {
    expect(objectName("image.png")).not.toBe(objectName("image.png"))
  })

  test("names without an extension stay readable", () => {
    expect(objectName("README")).toMatch(/^[0-9a-f]{12}_README$/)
  })

  test("strips path traversal and control characters", () => {
    expect(sanitizeName("../../etc/passwd")).toBe("passwd")
    expect(sanitizeName("bad\u0000name.txt")).toBe("badname.txt")
  })

  test("limits extensions to a safe shape", () => {
    expect(safeExtension("photo.PNG")).toBe(".png")
    expect(safeExtension("archive.tar.gz")).toBe(".gz")
    expect(safeExtension("no-extension")).toBe(".bin")
  })

  test("keys are short and non-predictable", () => {
    const key = makeKey("My Photo.png")
    expect(key).toMatch(/^u\/[0-9a-f]{12}_My-Photo\.png$/)
    expect(makeKey("My Photo.png")).not.toBe(key)
  })
})

describe("blocked mime types", () => {
  test("rejects active browser content", () => {
    expect(isBlockedMime("image/svg+xml")).toBe(true)
    expect(isBlockedMime("text/html")).toBe(true)
    expect(isBlockedMime("text/plain")).toBe(false)
    expect(isBlockedMime("image/png")).toBe(false)
  })
})