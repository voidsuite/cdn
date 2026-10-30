/**
 * Void Links (url.voidsuite.cc) integration.
 *
 * The CDN creates short links anonymously: links need no VoidAuth session,
 * and anonymous creation keeps a stable `anonId` so the owner can later claim
 * their links in the Void Links UI.
 */

const ANON_ID_KEY = "voidcdn:anonId"

function anonId(): string {
  try {
    const existing = localStorage.getItem(ANON_ID_KEY)
    if (existing && /^[a-zA-Z0-9-]{16,64}$/.test(existing)) return existing
    const next = crypto.randomUUID()
    localStorage.setItem(ANON_ID_KEY, next)
    return next
  } catch {
    return crypto.randomUUID()
  }
}

export interface ShortLink {
  shortUrl: string
  destination: string
}

export async function shortenWithVoidUrl(baseUrl: string, destination: string): Promise<ShortLink> {
  const id = anonId()
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/links`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Anon-Id": id },
    body: JSON.stringify({ destination, anonId: id }),
  })

  const data = (await response.json().catch(() => null)) as
    | { link?: { shortUrl?: string; destination?: string }; error?: string }
    | null

  if (!response.ok) {
    throw new Error(data?.error || `Could not shorten the link (${response.status}).`)
  }
  if (!data?.link?.shortUrl) throw new Error("Void Links did not return a short URL.")

  return {
    shortUrl: data.link.shortUrl,
    destination: data.link.destination || destination,
  }
}