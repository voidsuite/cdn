export class ApiError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown; query?: Record<string, string | number | boolean | undefined> }

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = options
  const response = await fetch(buildUrl(path, query), {
    ...rest,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const contentType = response.headers.get("content-type") || ""
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "")

  if (!response.ok) {
    const message =
      (data && typeof data === "object" && "error" in data && String((data as { error: unknown }).error)) ||
      `Request failed (${response.status})`
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("voidcdn:unauthorized"))
    }
    throw new ApiError(message, response.status, data && typeof data === "object" ? (data as { code?: string }).code : undefined)
  }

  return data as T
}

export const get = <T>(path: string, query?: RequestOptions["query"]) => api<T>(path, { method: "GET", query })
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body })
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body })
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" })

export async function startLogin(): Promise<void> {
  const { authUrl } = await api<{ authUrl: string }>("/api/auth/login")
  const returnTo = `${window.location.pathname}${window.location.search}`
  if (returnTo && returnTo !== "/login") sessionStorage.setItem("voidcdn:returnTo", returnTo)
  window.location.assign(authUrl)
}

export function uploadWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  options: { withCredentials?: boolean; onProgress?: (percent: number) => void } = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url, true)
    xhr.withCredentials = options.withCredentials === true
    for (const [key, value] of Object.entries(headers)) {
      try {
        xhr.setRequestHeader(key, value)
      } catch {
        /* header forbidden by browser */
      }
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && options.onProgress) {
        options.onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
      }
    }
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText })
    xhr.onerror = () => reject(new Error("Network error during upload"))
    xhr.onabort = () => reject(new Error("Upload cancelled"))
    xhr.send(file)
  })
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement("textarea")
      area.value = text
      area.style.position = "fixed"
      area.style.opacity = "0"
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(area)
      return ok
    } catch {
      return false
    }
  }
}

export function absoluteUrl(url: string | null): string {
  if (!url) return ""
  if (/^https?:\/\//i.test(url)) return url
  return `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`
}