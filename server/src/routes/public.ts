/**
 * /f/:key — public object passthrough for local storage and pull zones that
 * are not configured. Private objects are never served here.
 */

import { Hono } from "hono"
import { getFileByKey } from "../db/files.js"
import { serveFile } from "../lib/serve.js"

const publicRoutes = new Hono()

publicRoutes.get("/f/:key{.+}", async (c) => {
  const file = getFileByKey(c.req.param("key"))
  if (!file || file.visibility === "private") return c.json({ error: "File not found" }, 404)
  if (file.expires_at !== null && file.expires_at <= Date.now()) {
    return c.json({ error: "File has expired" }, 410)
  }
  return serveFile(c, file, {
    download: c.req.query("download") === "1",
    // Link-only files are cacheable; private files never reach this route.
    cacheSeconds: 60 * 60,
  })
})

export default publicRoutes
