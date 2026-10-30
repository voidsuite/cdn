import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useNavigate } from "react-router"
import { Check, Copy, KeyRound, Loader2, LogOut, Plus, ShieldCheck, Trash2 } from "lucide-react"
import Dialog from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/contexts/auth"
import { useToast } from "@/contexts/toast"
import { copyText, del, get, post, ApiError } from "@/lib/api"
import { formatBytes, formatDate, formatDateTime, initials, relativeTime, retentionText } from "@/lib/format"
import type { FileStats, TokenRecord } from "@/lib/types"
import { cn } from "@/lib/utils"

const TOKEN_SCOPES = [
  { value: "files:read", label: "Read files", hint: "List files and generate links" },
  { value: "files:upload", label: "Upload", hint: "Create upload intents and upload files" },
  { value: "files:delete", label: "Delete", hint: "Delete your files" },
  { value: "files:share", label: "Share", hint: "Rename files and change visibility" },
  { value: "stats:read", label: "Stats", hint: "Read storage usage" },
] as const

type Tab = "account" | "storage" | "api"

const TABS: { id: Tab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "storage", label: "Storage" },
  { id: "api", label: "API" },
]

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        {description && <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">{children}</div>
    </section>
  )
}

function Row({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="w-28 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 truncate text-right text-xs", mono && "font-mono text-[11px] text-muted-foreground")}>
        {children}
      </span>
    </div>
  )
}

export function SettingsPage() {
  const { user, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>("account")
  const [stats, setStats] = useState<FileStats | null>(null)
  const [tokens, setTokens] = useState<TokenRecord[]>([])
  const [tokensLoading, setTokensLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [scopes, setScopes] = useState<string[]>(["files:read", "files:upload"])
  const [expiresInDays, setExpiresInDays] = useState("90")
  const [creating, setCreating] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState<TokenRecord | null>(null)
  const [revokingBusy, setRevokingBusy] = useState(false)

  const loadTokens = useCallback(async () => {
    setTokensLoading(true)
    try {
      const data = await get<{ tokens: TokenRecord[] }>("/api/tokens")
      setTokens(data.tokens)
    } catch (err) {
      toast.addToast(err instanceof ApiError ? err.message : "Could not load API tokens.", "error")
    } finally {
      setTokensLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void get<FileStats>("/api/files/stats").then(setStats).catch(() => {})
    void loadTokens()
  }, [loadTokens])

  if (!user) return null

  const quota = stats?.storage.quota ?? user.quotaBytes
  const used = stats?.storage.used ?? 0
  const percent = stats?.storage.percent ?? (quota ? Math.min(100, Math.round((used / quota) * 100)) : 0)

  const toggleScope = (scope: string) => {
    setScopes((current) =>
      current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope],
    )
  }

  const createToken = async () => {
    if (!name.trim()) return
    setCreating(true)
    try {
      const data = await post<{ token: string; apiToken: TokenRecord }>("/api/tokens", {
        name: name.trim(),
        scopes,
        expiresInDays: expiresInDays === "never" ? null : Number(expiresInDays),
      })
      setNewToken(data.token)
      setCreateOpen(false)
      setName("")
      setScopes(["files:read", "files:upload"])
      setExpiresInDays("90")
      toast.addToast("API token created", "success")
      void loadTokens()
    } catch (err) {
      toast.addToast(err instanceof ApiError ? err.message : "Could not create the token.", "error")
    } finally {
      setCreating(false)
    }
  }

  const copyNewToken = async () => {
    if (!newToken) return
    const ok = await copyText(newToken)
    setCopied(ok)
    if (ok) toast.addToast("Token copied", "success")
  }

  const revokeToken = async () => {
    if (!revoking) return
    setRevokingBusy(true)
    try {
      await del(`/api/tokens/${revoking.id}`)
      setTokens((current) => current.filter((token) => token.id !== revoking.id))
      setRevoking(null)
      toast.addToast("Token revoked", "success")
    } catch (err) {
      toast.addToast(err instanceof ApiError ? err.message : "Could not revoke the token.", "error")
    } finally {
      setRevokingBusy(false)
    }
  }

  const signOut = async () => {
    await logout()
    navigate("/login", { replace: true })
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8 sm:py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">Account, storage and API access.</p>
      </div>

      <div className="mt-5 flex w-fit gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs transition-colors",
              tab === entry.id
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-6">
        {tab === "account" && (
          <>
            <Section title="VoidAuth account" description="Managed on auth.voidsuite.cc.">
              <div className="flex items-center gap-3 border-b border-border px-4 py-4">
                <Avatar className="size-11">
                  <AvatarImage src={user.picture || undefined} alt={user.name} />
                  <AvatarFallback className="text-sm">{initials(user.name, user.email.charAt(0).toUpperCase())}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{user.name}</p>
                    {user.isAdmin && (
                      <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
                        <ShieldCheck className="size-2.5" />
                        Admin
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
              </div>
              <div className="divide-y divide-border">
                <Row label="Role">{user.role}</Row>
                <Row label="Member since">{formatDate(user.createdAt)}</Row>
                <Row label="Account ID" mono>
                  {user.id}
                </Row>
              </div>
            </Section>

            <div className="flex justify-end">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => void signOut()}>
                <LogOut className="size-3.5" />
                Sign out
              </Button>
            </div>
          </>
        )}

        {tab === "storage" && (
          <Section title="Storage" description="Quota and the automatic retention rules in effect.">
            <div className="space-y-3 px-4 py-4">
              <div className="flex items-end justify-between">
                <p className="text-lg font-semibold tracking-tight">
                  {formatBytes(used)}
                  {!stats?.storage.unlimited && (
                    <span className="text-sm font-normal text-muted-foreground"> / {formatBytes(quota ?? 0)}</span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">{stats?.storage.unlimited ? "Unlimited" : `${percent}%`}</p>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-all", percent >= 90 ? "bg-destructive" : percent >= 70 ? "bg-amber-500" : "bg-primary")}
                  style={{ width: `${stats?.storage.unlimited || percent <= 0 ? 0 : Math.max(2, percent)}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg border border-border px-2.5 py-2">
                  <p className="text-[10px] text-muted-foreground">Files</p>
                  <p className="font-medium">{stats?.files ?? 0}</p>
                </div>
                <div className="rounded-lg border border-border px-2.5 py-2">
                  <p className="text-[10px] text-muted-foreground">Expiring</p>
                  <p className="font-medium">{stats?.expiringSoon ?? 0}</p>
                </div>
                <div className="rounded-lg border border-border px-2.5 py-2">
                  <p className="text-[10px] text-muted-foreground">Per file</p>
                  <p className="font-medium">{stats?.maxUploadBytes === null ? "Unlimited" : formatBytes(stats?.maxUploadBytes ?? 0)}</p>
                </div>
              </div>
            </div>
            <div className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
              Files over {formatBytes(stats?.defaults.largeFileThresholdBytes ?? 50 * 1024 * 1024)} expire after{" "}
              {retentionText(stats?.defaults.largeFileRetentionHours ?? 168)}. Smaller files:{" "}
              {retentionText(stats?.defaults.defaultRetentionHours ?? 0)}.
            </div>
          </Section>
        )}

        {tab === "api" && (
          <Section title="API tokens" description="For scripts and CI. Shown once, stored hashed.">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <KeyRound className="size-3.5" />
                {tokens.length} active token{tokens.length === 1 ? "" : "s"}
              </div>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCreateOpen(true)}>
                <Plus className="size-3.5" />
                New token
              </Button>
            </div>
            {tokensLoading ? (
              <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" /> Loading tokens…
              </div>
            ) : tokens.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">No API tokens yet.</div>
            ) : (
              <div className="divide-y divide-border">
                {tokens.map((token) => (
                  <div key={token.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-xs font-medium">{token.name}</p>
                        <code className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{token.prefix}…</code>
                      </div>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {token.scopes.join(", ")} · {token.expiresAt ? `expires ${relativeTime(token.expiresAt)}` : "never expires"} ·{" "}
                        {token.lastUsedAt ? `last used ${formatDateTime(token.lastUsedAt)}` : "never used"}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon-xs" onClick={() => setRevoking(token)} title="Revoke token">
                      <Trash2 className="text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}
      </div>

      {/* Create token */}
      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create API token"
        description="Pick only the permissions the script needs."
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Name</label>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Deploy script" maxLength={64} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Permissions</label>
            <div className="grid gap-1">
              {TOKEN_SCOPES.map((scope) => {
                const active = scopes.includes(scope.value)
                return (
                  <button
                    key={scope.value}
                    type="button"
                    onClick={() => toggleScope(scope.value)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                      active ? "border-foreground/30 bg-muted/60" : "border-border hover:bg-muted/40",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        active ? "border-primary bg-primary text-primary-foreground" : "border-border",
                      )}
                    >
                      {active && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-medium">{scope.label}</span>
                      <span className="block text-[10px] text-muted-foreground">{scope.hint}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Expires</label>
            <Select value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)}>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
              <option value="never">Never</option>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void createToken()} disabled={creating || !name.trim() || scopes.length === 0}>
              {creating && <Loader2 className="size-3.5 animate-spin" />}
              Create token
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Reveal token */}
      <Dialog
        open={!!newToken}
        onOpenChange={(open) => {
          if (!open) {
            setNewToken(null)
            setCopied(false)
          }
        }}
        title="Copy your token now"
        description="This is the only time the full token is shown."
      >
        {newToken && (
          <div className="space-y-3">
            <div className="break-all rounded-xl border border-border bg-muted/40 px-3 py-2 font-mono text-[11px]">{newToken}</div>
            <Button className="w-full gap-1.5" size="sm" onClick={() => void copyNewToken()}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy token"}
            </Button>
            <p className="text-[11px] text-muted-foreground">Send it as <code className="rounded bg-muted px-1">Authorization: Bearer &lt;token&gt;</code>.</p>
          </div>
        )}
      </Dialog>

      {/* Revoke */}
      <Dialog
        open={!!revoking}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke token"
        description="Anything using this token will stop working immediately."
      >
        {revoking && (
          <div className="space-y-4">
            <p className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs">
              <span className="font-medium">{revoking.name}</span> · {revoking.prefix}…
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRevoking(null)}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={() => void revokeToken()} disabled={revokingBusy}>
                {revokingBusy && <Loader2 className="size-3.5 animate-spin" />}
                Revoke
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </main>
  )
}