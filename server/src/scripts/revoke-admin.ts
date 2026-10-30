/**
 * Revoke the local admin flag.
 * Usage: bun run admin:revoke <email-or-user-id>
 */

import { getUserByEmail, getUserById, setAdmin } from "../db/users.js"

const arg = (process.argv[2] || "").trim()
if (!arg) {
  console.error("Usage: bun run admin:revoke <email-or-user-id>")
  process.exit(1)
}

const user = getUserByEmail(arg) || getUserById(arg)
if (!user) {
  console.error(`No CDN user found for "${arg}".`)
  process.exit(1)
}

setAdmin(user.id, false)
console.log(`Revoked admin from ${user.email} (${user.id}).`)
