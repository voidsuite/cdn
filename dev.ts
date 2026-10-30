/**
 * VoidCDN dev runner — starts the client (Vite, 5180) and the gateway
 * (Bun + Hono, 3007) together. Ctrl+C stops both.
 */

import { spawn } from "bun"

const procs: { p: ReturnType<typeof spawn>; name: string }[] = []

function start(name: string, cwd: string, args: string[]) {
  const p = spawn(["bun", ...args], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  })
  procs.push({ p, name })
  p.exited.then((code) => {
    if (code !== 0) {
      console.error(`\n[cdn] ${name} exited with code ${code}`)
      shutdown()
    }
  })
}

function shutdown() {
  for (const { p, name } of procs) {
    try {
      p.kill()
    } catch {
      /* already gone */
    }
    console.log(`[cdn] stopped ${name}`)
  }
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

start("client", "client", ["--env-file=../.env", "run", "dev"])
start("server", "server", ["--env-file=../.env", "run", "start"])

console.log("[cdn] client → http://localhost:5180 · gateway → http://localhost:3007")