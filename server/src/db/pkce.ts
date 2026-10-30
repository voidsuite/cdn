import { db, now } from "./connection.js"

const STATE_TTL_MS = 10 * 60 * 1000

const insertState = db.query(`
  INSERT INTO pkce_states (state, verifier, expires_at, created_at) VALUES (?, ?, ?, ?)
`)
const selectState = db.query("SELECT verifier, expires_at FROM pkce_states WHERE state = ?")
const deleteState = db.query("DELETE FROM pkce_states WHERE state = ?")
const deleteExpired = db.query("DELETE FROM pkce_states WHERE expires_at < ?")

export function storePkceState(state: string, verifier: string): void {
  insertState.run(state, verifier, now() + STATE_TTL_MS, now())
  deleteExpired.run(now() - STATE_TTL_MS)
}

export function takePkceVerifier(state: string): string | null {
  const row = selectState.get(state) as { verifier: string; expires_at: number } | null
  deleteState.run(state)
  if (!row) return null
  if (row.expires_at < now()) return null
  return row.verifier
}
