/**
 * voidcdn gateway — serves the built client (client/dist) plus the API:
 *   /api/auth/*     VoidAuth OAuth proxy (PKCE, httpOnly session cookie)
 *   /api/files/*    user file management, quota, uploads, downloads
 *   /api/admin/*    elevated admin API (short-lived locked session)
 *   /api/tokens/*   personal API tokens
 *   /api/config     public runtime configuration
 *   /f/:key         public object passthrough (local / no pull zone)
 */

import { Hono } from "hono"
import { cors } from "hono/cors"
import path from "node:path"
import { fileURLToPath } from "node:url"
import config from "./config.js"
import authRoutes from "./routes/auth.js"
import fileRoutes from "./routes/files.js"
import adminRoutes from "./routes/admin.js"
import tokenRoutes from "./routes/tokens.js"
import configRoutes from "./routes/config.js"
import publicRoutes from "./routes/public.js"
import { startSweeper } from "./jobs/sweeper.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.resolve(__dirname, "../../client/dist")

const app = new Hono()

app.use(
  "*",
  cors({
    origin: config.allowedOrigins.length ? config.allowedOrigins : config.appUrl,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["Content-Length", "Content-Disposition"],
    credentials: true,
    maxAge: 86400,
  })
)

app.use("*", async (c, next) => {
  await next()
  const res = c.res
  if (res.status >= 400) {
    const body = await res.clone().text().catch(() => "")
    console.log(`[http] ${c.req.method} ${c.req.path} -> ${res.status} ${body.slice(0, 200)}`)
  } else {
    console.log(`[http] ${c.req.method} ${c.req.path} -> ${res.status}`)
  }
})

app.route("/api/auth", authRoutes)
app.route("/api/files", fileRoutes)
app.route("/api/admin", adminRoutes)
app.route("/api/tokens", tokenRoutes)
app.route("/api", configRoutes)
app.route("/", publicRoutes)

app.get("/health", (c) => c.json({ status: "ok", service: "cdn", driver: config.storage.driver }))
app.get("/api/health", (c) => c.json({ status: "ok", service: "cdn", driver: config.storage.driver }))

const MIME_TYPES: Record<string, string> = {
  html: "text/html",
  css: "text/css",
  js: "application/javascript",
  mjs: "application/javascript",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  webp: "image/webp",
  avif: "image/avif",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  txt: "text/plain",
  map: "application/json",
  webmanifest: "application/manifest+json",
}

app.get("*", async (c) => {
  const reqPath = c.req.path
  const filePath = reqPath === "/" ? "/index.html" : reqPath
  const ext = filePath.split(".").pop()?.toLowerCase() || ""
  const f = Bun.file(path.join(DIST_DIR, filePath))
  if (await f.exists()) {
    return new Response(f, {
      headers: { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" },
    })
  }
  if (!reqPath.startsWith("/api/")) {
    const fallback = Bun.file(path.join(DIST_DIR, "index.html"))
    if (await fallback.exists()) {
      return new Response(fallback, { headers: { "Content-Type": "text/html" } })
    }
  }
  return c.json({ error: "Not found" }, 404)
})

app.onError((err, c) => {
  console.error("[cdn] unhandled error", err)
  return c.json({ error: "Internal server error" }, 500)
})

console.log(`[cdn] gateway starting on :${config.port} (${config.appUrl}) driver=${config.storage.driver}`)
startSweeper()

export default {
  port: config.port,
  // In production the container uses host networking; bind to loopback so the
  // gateway is only reachable through nginx.
  hostname: process.env.HOST || "0.0.0.0",
  fetch: app.fetch,
  // Bun's 128 MiB default silently 413s large uploads before Hono sees them.
  maxRequestBodySize: config.upload.maxRequestBodyBytes,
}
