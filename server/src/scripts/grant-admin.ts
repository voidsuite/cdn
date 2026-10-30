/**
 * Grant the local admin flag used for the CDN admin panel.
 * Usage: bun run admin:grant <email-or-user-id>
 *
 * The live VoidAuth `role` claim is still required to unlock the panel. This
 * script is only a bootstrap / recovery tool for the local cache.
 */

import { getUserByEmail, getUserById, setAdmin } from "../db/users.js"

const arg = (process.argv[2] || "").trim()
if (!arg) {
  console.error("Usage: bun run admin:grant <email-or-user-id>")
  process.exit(1)
}

const user = getUserByEmail(arg) || getUserById(arg)
if (!user) {
  console.error(`No CDN user found for "${arg}". Sign in once first.`)
  process.exit(1)
}

setAdmin(user.id, true)
console.log(`Granted admin to ${user.email} (${user.id}).`)
console.log("VoidAuth must still return role=admin to unlock the admin panel.")
