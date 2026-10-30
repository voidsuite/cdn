import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router"
import {
  Activity,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  HardDrive,
  Loader2,
  Lock,
  LockOpen,
  Search,
  Settings2,
  ShieldAlert,
  Trash2,
  Users,
  Files,
  RefreshCw,
} from "lucide-react"
import Dialog from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/contexts/auth"
import { useToast } from "@/contexts/toast"
import { del, get, patch, post, ApiError } from "@/lib/api"
import {
  expiryLabel,
  formatBytes,
  formatDate,
  formatDateTime,
  initials,
  relativeTime,
  retentionText,
} from "@/lib/format"
import type {
  AdminOverview,
  AdminUser,
  AdminUsersResponse,
  AuditEntry,
  FileItem,
  FilesResponse,
  GlobalSettings,
  Visibility,
} from "@/lib/types"
import { cn } from "@/lib/utils"

type Tab = "overview" | "files" | "users" | "settings" | "audit"

const DEFAULT_PRESETS = [24, 48, 72, 168, 336, 720, 2160, 4320, 8760]
const GB = 1024 * 1024 * 1024
const MB = 1024 * 1024

function isLocked(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 423 || err.code === "ADMIN_LOCKED")
}

function AdminSection({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">{children}</div>
    </section>
  )
}

function Stat({ label, value, hint, icon: Icon }: { label: string; value: string; hint?: string; icon: typeof HardDrive }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className="size-3.5 text-muted-foreground/70" />
      </div>
      <p className="mt-1.5 text-lg font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const variant = visibility === "unlisted" ? "secondary" : "outline"
  return (
    <Badge variant={variant} className="px-1.5 py-0 text-[10px] capitalize">
      {visibility}
    </Badge>
  )
}

function RetentionSelect({
  value,
  onChange,
  presets,
  allowInherit,
  customHours,
  onCustomHours,
  minHours = 24,
  keepLabel,
  className,
}: {
  value: string
  onChange: (value: string) => void
  presets: number[]
  allowInherit?: boolean
  customHours?: string
  onCustomHours?: (value: string) => void
  minHours?: number
  keepLabel?: string
  className?: string
}) {
  return (
    <div className="space-y-1.5">
      <Select value={value} onChange={(event) => onChange(event.target.value)} className={className}>
        {keepLabel && <option value="keep">{keepLabel}</option>}
        {allowInherit && <option value="inherit">Inherit account / global</option>}
        <option value="unlimited">Unlimited</option>
        {presets.map((hours) => (
          <option key={hours} value={String(hours)}>
            {retentionText(hours)}
          </option>
        ))}
        <option value="custom">Custom hours…</option>
      </Select>
      {value === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={minHours}
            step={1}
            value={customHours ?? ""}
            onChange={(event) => onCustomHours?.(event.target.value)}
            placeholder={`Hours (min ${minHours})`}
            aria-label="Custom retention in hours"
          />
          <span className="shrink-0 text-[11px] text-muted-foreground">hours</span>
        </div>
      )}
    </div>
  )
}

/** Convert a stored retention value into the selector state + custom input. */
function retentionState(hours: number | null | undefined, presets: number[]): { mode: string; custom: string } {
  if (hours === null || hours === undefined) return { mode: "inherit", custom: "" }
  if (hours <= 0) return { mode: "unlimited", custom: "" }
  if (presets.includes(hours)) return { mode: String(hours), custom: "" }
  return { mode: "custom", custom: String(hours) }
}

function UserAvatar({ user, className }: { user: { name: string; email: string; picture?: string | null }; className?: string }) {
  return (
    <div className={cn("flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-[10px] font-semibold text-primary-foreground", className)}>
      {user.picture ? (
        <img src={user.picture} alt="" className="size-full object-cover" />
      ) : (
        initials(user.name, user.email.charAt(0).toUpperCase())
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

export function AdminPage() {
  const { isAdmin, loading } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>("overview")
  const [gate, setGate] = useState<"checking" | "locked" | "unlocked">("checking")
  const [unlocking, setUnlocking] = useState(false)
  const [gateError, setGateError] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [presets, setPresets] = useState<number[]>(DEFAULT_PRESETS)

  const checkSession = useCallback(async () => {
    try {
      const data = await get<{ isAdmin: boolean; active: boolean; expiresAt: number | null }>("/api/admin/session")
      if (data.active) {
        setGate("unlocked")
        setExpiresAt(data.expiresAt)
      } else {
        setGate("locked")
      }
    } catch {
      setGate("locked")
    }
  }, [])

  useEffect(() => {
    if (!loading) void checkSession()
  }, [checkSession, loading])

  const loadOverview = useCallback(async () => {
    try {
      const data = await get<AdminOverview>("/api/admin/overview")
      setOverview(data)
      if (data.retention?.presets?.length) setPresets(data.retention.presets)
    } catch (err) {
      if (isLocked(err)) setGate("locked")
    }
  }, [])

  useEffect(() => {
    if (gate === "unlocked") void loadOverview()
  }, [gate, loadOverview])

  const unlock = async () => {
    setUnlocking(true)
    setGateError(null)
    try {
      const data = await post<{ active: boolean; expiresAt: number }>("/api/admin/session")
      setGate("unlocked")
      setExpiresAt(data.expiresAt)
      toast.addToast("Admin panel unlocked", "success")
    } catch (err) {
      setGateError(err instanceof ApiError ? err.message : "Could not unlock the admin panel.")
    } finally {
      setUnlocking(false)
    }
  }

  const lock = async () => {
    try {
      await del("/api/admin/session")
    } catch {
      /* lock locally anyway */
    }
    setGate("locked")
    setExpiresAt(null)
    toast.addToast("Admin panel locked", "info")
  }

  const onLocked = () => {
    setGate("locked")
    setExpiresAt(null)
    toast.addToast("Admin session expired. Unlock again to continue.", "info")
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col items-center justify-center gap-4 px-4 py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <ShieldAlert className="size-6" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Admins only</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your VoidAuth account does not have the <code className="rounded bg-muted px-1 text-xs">role=admin</code> claim.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/files">Back to files</Link>
        </Button>
      </main>
    )
  }

  if (gate === "checking") {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (gate === "locked") {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col justify-center px-4 py-16">
        <div className="space-y-6 rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Lock className="size-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold">Admin panel locked</h1>
            <p className="text-sm text-muted-foreground">
              Unlocking re-checks your live VoidAuth role. Elevated access lasts{" "}
              {overview ? "a short session" : "30 minutes"} and is scoped to this browser.
            </p>
          </div>
          {gateError && (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{gateError}</p>
          )}
          <Button className="w-full" onClick={() => void unlock()} disabled={unlocking}>
            {unlocking ? <Loader2 className="size-4 animate-spin" /> : <LockOpen className="size-4" />}
            {unlocking ? "Verifying with VoidAuth…" : "Unlock admin panel"}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Requires the VoidAuth <span className="font-mono">role</span> scope, or an email on the CDN admin allowlist.
          </p>
        </div>
      </main>
    )
  }

  const tabs: { id: Tab; label: string; icon: typeof BarChart3 }[] = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "files", label: "Files", icon: Files },
    { id: "users", label: "Users", icon: Users },
    { id: "settings", label: "Settings", icon: Settings2 },
    { id: "audit", label: "Audit", icon: Activity },
  ]

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            Admin
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-medium">
              elevated
            </Badge>
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage files, users, limits, and retention for the whole CDN.
            {expiresAt && <span className="text-muted-foreground/80"> Session ends {relativeTime(expiresAt)}.</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void loadOverview()}>
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void lock()}>
            <Lock className="size-3.5" />
            Lock
          </Button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-muted/30 p-1 tab-scrollbar">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              tab === item.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <item.icon className="size-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab overview={overview} presets={presets} onRefresh={loadOverview} />}
      {tab === "files" && <FilesTab onLocked={onLocked} presets={presets} />}
      {tab === "users" && <UsersTab onLocked={onLocked} presets={presets} />}
      {tab === "settings" && <SettingsTab onLocked={onLocked} presets={presets} onSaved={loadOverview} />}
      {tab === "audit" && <AuditTab onLocked={onLocked} />}
    </main>
  )
}

// ---------------------------------------------------------------------------

function OverviewTab({
  overview,
  presets,
  onRefresh,
}: {
  overview: AdminOverview | null
  presets: number[]
  onRefresh: () => Promise<void>
}) {
  const toast = useToast()
  if (!overview) {
    return (
      <div className="flex items-center justify-center py-16 text-xs text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Loading overview…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Stored" value={formatBytes(overview.storage.used)} hint={`${overview.storage.files} files`} icon={Database} />
        <Stat label="Users" value={String(overview.users.total)} hint={`${overview.users.admins} admins`} icon={Users} />
        <Stat label="Downloads" value={String(overview.storage.downloads)} hint="All time" icon={Download} />
        <Stat label="Expiring soon" value={String(overview.storage.expiring)} hint="Next 7 days" icon={HardDrive} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminSection title="Storage driver" description="Where uploads live and how they are delivered.">
          <div className="divide-y divide-border text-xs">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-muted-foreground">Driver</span>
              <span className="font-medium capitalize">{overview.driver.name}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-muted-foreground">Direct uploads</span>
              <span className="font-medium">{overview.driver.supportsPresigned ? "Available" : "Gateway proxy"}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-muted-foreground">Signed reads</span>
              <span className="font-medium">{overview.driver.supportsSignedGet ? "Available" : "Gateway proxy"}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-muted-foreground">Pending uploads</span>
              <span className="font-medium">{overview.storage.pending}</span>
            </div>
          </div>
        </AdminSection>

        <AdminSection title="Global defaults" description="Applied to new accounts unless overridden.">
          <div className="divide-y divide-border text-xs">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-muted-foreground">Default quota</span>
              <span className="font-medium">{formatBytes(overview.settings.defaultQuotaBytes)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-muted-foreground">Max upload</span>
              <span className="font-medium">{formatBytes(overview.settings.maxUploadBytes)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-muted-foreground">Large file threshold</span>
              <span className="font-medium">{formatBytes(overview.settings.largeFileThresholdBytes)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-muted-foreground">Large file retention</span>
              <span className="font-medium">{retentionText(overview.settings.largeFileRetentionHours)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-muted-foreground">Default visibility</span>
              <span className="font-medium capitalize">{overview.settings.defaultVisibility}</span>
            </div>
          </div>
        </AdminSection>
      </div>

      <AdminSection
        title="Recent activity"
        description="Admin and file events across the CDN."
        action={
          <Button variant="ghost" size="xs" onClick={() => void onRefresh().catch(() => toast.addToast("Could not refresh", "error"))}>
            Refresh
          </Button>
        }
      >
        {overview.recentAudit.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">No activity yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {overview.recentAudit.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 px-4 py-2.5">
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/60" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">
                    <span className="font-medium">{entry.action}</span>
                    {entry.actorEmail && <span className="text-muted-foreground"> · {entry.actorEmail}</span>}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {formatDateTime(entry.createdAt)}
                    {entry.targetType && ` · ${entry.targetType}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminSection>

      <p className="text-[11px] text-muted-foreground">
        Retention presets: {presets.map((hours) => retentionText(hours)).join(" · ")}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------

function FilesTab({ onLocked, presets }: { onLocked: () => void; presets: number[] }) {
  const toast = useToast()
  const [files, setFiles] = useState<FileItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [visibility, setVisibility] = useState("all")
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<FileItem | null>(null)
  const [editName, setEditName] = useState("")
  const [editVisibility, setEditVisibility] = useState<Visibility>("unlisted")
  const [editRetention, setEditRetention] = useState("keep")
  const [editRetentionCustom, setEditRetentionCustom] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<FileItem | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)

  const limit = 30

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await get<FilesResponse>("/api/admin/files", { page, limit, search, visibility })
      setFiles(data.files)
      setTotal(data.total)
    } catch (err) {
      if (isLocked(err)) return onLocked()
      toast.addToast(err instanceof ApiError ? err.message : "Could not load files.", "error")
    } finally {
      setLoading(false)
    }
  }, [limit, onLocked, page, search, toast, visibility])

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    void load()
  }, [load])

  const beginEdit = (file: FileItem) => {
    setEditing(file)
    setEditName(file.name)
    setEditVisibility(file.visibility)
    setEditRetention("keep")
    setEditRetentionCustom("")
  }

  const save = async () => {
    if (!editing) return
    if (editRetention === "custom" && !(Number(editRetentionCustom) >= 24)) {
      toast.addToast("Custom retention must be at least 24 hours.", "error")
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = { name: editName.trim(), visibility: editVisibility }
      if (editRetention !== "keep") {
        body.retentionHours =
          editRetention === "unlimited"
            ? null
            : editRetention === "custom"
              ? Number(editRetentionCustom)
              : Number(editRetention)
      }
      await patch(`/api/admin/files/${editing.id}`, body)
      setEditing(null)
      toast.addToast("File updated", "success")
      void load()
    } catch (err) {
      if (isLocked(err)) return onLocked()
      toast.addToast(err instanceof ApiError ? err.message : "Could not update the file.", "error")
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!deleting) return
    setDeletingBusy(true)
    try {
      await del(`/api/admin/files/${deleting.id}`)
      setDeleting(null)
      toast.addToast("File deleted", "success")
      void load()
    } catch (err) {
      if (isLocked(err)) return onLocked()
      toast.addToast(err instanceof ApiError ? err.message : "Could not delete the file.", "error")
    } finally {
      setDeletingBusy(false)
    }
  }

  const pages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search all files…" className="pl-8" />
        </div>
        <Select value={visibility} onChange={(event) => { setVisibility(event.target.value); setPage(1) }} className="h-8 w-auto min-w-32 text-xs">
          <option value="all">Any visibility</option>
          <option value="unlisted">Unlisted</option>
          <option value="private">Private</option>
        </Select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-xs text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Loading files…
          </div>
        ) : files.length === 0 ? (
          <p className="px-4 py-16 text-center text-xs text-muted-foreground">No files match.</p>
        ) : (
          <div className="divide-y divide-border">
            {files.map((file) => (
              <div key={file.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <VisibilityBadge visibility={file.visibility} />
                    {file.expiresAt !== null && (
                      <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">{expiryLabel(file.expiresAt)}</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {formatBytes(file.size)} · {file.owner ? `${file.owner.name} (${file.owner.email})` : "Unknown owner"} ·{" "}
                    {formatDate(file.createdAt)} · {file.downloads} downloads
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {file.url && (
                    <Button variant="ghost" size="icon-xs" title="Copy link" onClick={() => void navigator.clipboard.writeText(file.url!).then(() => toast.addToast("Link copied", "success")).catch(() => toast.addToast("Could not copy", "error"))}>
                      <Copy />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon-xs" title="Edit" onClick={() => beginEdit(file)}>
                    <Settings2 />
                  </Button>
                  <Button variant="ghost" size="icon-xs" title="Delete" onClick={() => setDeleting(file)}>
                    <Trash2 className="text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page} of {pages} · {total} files</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              <ChevronLeft className="size-3.5" /> Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)} title="Edit file" description="Admin overrides apply immediately.">
        {editing && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Name</label>
              <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Visibility</label>
              <Select value={editVisibility} onChange={(event) => setEditVisibility(event.target.value as Visibility)}>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Retention</label>
              <RetentionSelect
                value={editRetention}
                onChange={setEditRetention}
                presets={presets}
                customHours={editRetentionCustom}
                onCustomHours={setEditRetentionCustom}
                keepLabel={`Keep current (${editing.retentionLabel})`}
              />
              {editing.expiresAt !== null && (
                <p className="text-[11px] text-muted-foreground">Currently expires {formatDateTime(editing.expiresAt)}.</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={saving || !editName.trim() || (editRetention === "custom" && !(Number(editRetentionCustom) >= 24))}
              >
                {saving && <Loader2 className="size-3.5 animate-spin" />} Save
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)} title="Delete file" description="This deletes the object from storage for everyone.">
        {deleting && (
          <div className="space-y-4">
            <p className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs">
              <span className="font-medium">{deleting.name}</span> · {formatBytes(deleting.size)} · {deleting.owner?.email}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={() => void remove()} disabled={deletingBusy}>
                {deletingBusy && <Loader2 className="size-3.5 animate-spin" />} Delete
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------

function UsersTab({ onLocked, presets }: { onLocked: () => void; presets: number[] }) {
  const toast = useToast()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState("recent")
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [quotaGb, setQuotaGb] = useState("")
  const [maxMode, setMaxMode] = useState<"inherit" | "unlimited" | "custom">("inherit")
  const [maxMb, setMaxMb] = useState("")
  const [retMode, setRetMode] = useState("inherit")
  const [retCustom, setRetCustom] = useState("")
  const [saving, setSaving] = useState(false)

  const limit = 30

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await get<AdminUsersResponse>("/api/admin/users", { page, limit, search, sort })
      setUsers(data.users)
      setTotal(data.total)
    } catch (err) {
      if (isLocked(err)) return onLocked()
      toast.addToast(err instanceof ApiError ? err.message : "Could not load users.", "error")
    } finally {
      setLoading(false)
    }
  }, [limit, onLocked, page, search, sort, toast])

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    void load()
  }, [load])

  const beginEdit = (user: AdminUser) => {
    setEditing(user)
    setQuotaGb(user.quotaBytes ? String(Number((user.quotaBytes / GB).toFixed(2))) : "")
    if (user.maxUploadBytes === null) {
      setMaxMode("inherit")
      setMaxMb("")
    } else if (user.maxUploadBytes <= 0) {
      setMaxMode("unlimited")
      setMaxMb("")
    } else {
      setMaxMode("custom")
      setMaxMb(String(Math.round(user.maxUploadBytes / MB)))
    }
    const retention = retentionState(user.retentionHours, presets)
    setRetMode(retention.mode)
    setRetCustom(retention.custom)
  }

  const save = async () => {
    if (!editing) return
    if (retMode === "custom" && !(Number(retCustom) >= 24)) {
      toast.addToast("Custom retention must be at least 24 hours.", "error")
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        quotaBytes: quotaGb.trim() === "" ? -1 : Math.round(Number(quotaGb) * GB),
      }
      if (maxMode === "inherit") body.maxUploadBytes = null
      else if (maxMode === "unlimited") body.maxUploadBytes = -1
      else body.maxUploadBytes = Math.round(Number(maxMb) * MB)

      if (retMode === "inherit") body.retentionHours = null
      else if (retMode === "unlimited") body.retentionHours = -1
      else if (retMode === "custom") body.retentionHours = Number(retCustom)
      else body.retentionHours = Number(retMode)

      await patch(`/api/admin/users/${editing.id}`, body)
      setEditing(null)
      toast.addToast("Limits updated", "success")
      void load()
    } catch (err) {
      if (isLocked(err)) return onLocked()
      toast.addToast(err instanceof ApiError ? err.message : "Could not update the user.", "error")
    } finally {
      setSaving(false)
    }
  }

  const pages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search users…" className="pl-8" />
        </div>
        <Select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1) }} className="h-8 w-auto min-w-32 text-xs">
          <option value="recent">Recently active</option>
          <option value="usage">Most storage</option>
          <option value="name">Name</option>
          <option value="oldest">Oldest account</option>
        </Select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-xs text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Loading users…
          </div>
        ) : users.length === 0 ? (
          <p className="px-4 py-16 text-center text-xs text-muted-foreground">No users match.</p>
        ) : (
          <div className="divide-y divide-border">
            {users.map((user) => {
              const percent = user.usage.quota ? Math.min(100, Math.round((user.usage.used / user.usage.quota) * 100)) : 0
              return (
                <div key={user.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <UserAvatar user={user} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-medium">{user.name}</p>
                        {user.isAdmin && <Badge className="px-1.5 py-0 text-[9px]">Admin</Badge>}
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
                    </div>
                  </div>
                  <div className="flex w-full shrink-0 items-center gap-3 sm:w-56">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{formatBytes(user.usage.used)}</span>
                        <span>{user.usage.quota === null ? "Unlimited" : formatBytes(user.usage.quota)}</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full rounded-full", percent >= 90 ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.max(2, percent)}%` }} />
                      </div>
                    </div>
                    <Button variant="outline" size="xs" onClick={() => beginEdit(user)}>
                      Limits
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page} of {pages} · {total} users</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              <ChevronLeft className="size-3.5" /> Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing ? `Limits · ${editing.name}` : "Limits"}
        description="Account overrides win over global defaults. Leave quota blank for unlimited."
      >
        {editing && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Storage quota (GB)</label>
              <Input
                type="number"
                min={0}
                step="0.5"
                value={quotaGb}
                onChange={(event) => setQuotaGb(event.target.value)}
                placeholder="Unlimited"
              />
              <p className="text-[11px] text-muted-foreground">Blank = unlimited. Current usage {formatBytes(editing.usage.used)}.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Max single upload</label>
              <Select value={maxMode} onChange={(event) => setMaxMode(event.target.value as typeof maxMode)}>
                <option value="inherit">Inherit global limit</option>
                <option value="unlimited">Unlimited</option>
                <option value="custom">Custom</option>
              </Select>
              {maxMode === "custom" && (
                <Input type="number" min={1} value={maxMb} onChange={(event) => setMaxMb(event.target.value)} placeholder="Size in MB" />
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Retention override</label>
              <RetentionSelect
                value={retMode}
                onChange={setRetMode}
                presets={presets}
                allowInherit
                customHours={retCustom}
                onCustomHours={setRetCustom}
              />
              <p className="text-[11px] text-muted-foreground">Retention applies to future uploads from this account.</p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={saving || (maxMode === "custom" && (!maxMb || Number(maxMb) < 1)) || (quotaGb.trim() !== "" && Number(quotaGb) < 0) || (retMode === "custom" && !(Number(retCustom) >= 24))}
              >
                {saving && <Loader2 className="size-3.5 animate-spin" />} Save limits
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------

function SettingsTab({
  onLocked,
  presets,
  onSaved,
}: {
  onLocked: () => void
  presets: number[]
  onSaved: () => Promise<void>
}) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<GlobalSettings | null>(null)
  const [system, setSystem] = useState<Record<string, unknown> | null>(null)

  const [quotaGb, setQuotaGb] = useState("1")
  const [maxUploadGb, setMaxUploadGb] = useState("1")
  const [largeThresholdMb, setLargeThresholdMb] = useState("50")
  const [largeRetention, setLargeRetention] = useState("168")
  const [largeRetentionCustom, setLargeRetentionCustom] = useState("")
  const [defaultRetention, setDefaultRetention] = useState("unlimited")
  const [defaultRetentionCustom, setDefaultRetentionCustom] = useState("")
  const [visibility, setVisibility] = useState<Visibility>("unlisted")
  const [blocked, setBlocked] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await get<{ settings: GlobalSettings; retention: { presets: number[] } }>("/api/admin/settings")
      setSettings(data.settings)
      setQuotaGb(String(Number((data.settings.defaultQuotaBytes / GB).toFixed(2))))
      setMaxUploadGb(String(Number((data.settings.maxUploadBytes / GB).toFixed(2))))
      setLargeThresholdMb(String(Math.round(data.settings.largeFileThresholdBytes / MB)))
      const toMode = (hours: number): { mode: string; custom: string } =>
        hours <= 0
          ? { mode: "unlimited", custom: "" }
          : presets.includes(hours)
            ? { mode: String(hours), custom: "" }
            : { mode: "custom", custom: String(hours) }

      const large = toMode(data.settings.largeFileRetentionHours)
      setLargeRetention(large.mode)
      setLargeRetentionCustom(large.custom)
      const fallback = toMode(data.settings.defaultRetentionHours)
      setDefaultRetention(fallback.mode)
      setDefaultRetentionCustom(fallback.custom)
      setVisibility(data.settings.defaultVisibility)
      setBlocked(data.settings.blockedMimeTypes)
      const sys = await get<Record<string, unknown>>("/api/admin/system").catch(() => null)
      setSystem(sys)
    } catch (err) {
      if (isLocked(err)) return onLocked()
      toast.addToast(err instanceof ApiError ? err.message : "Could not load settings.", "error")
    } finally {
      setLoading(false)
    }
  }, [onLocked, presets, toast])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if ((largeRetention === "custom" && !(Number(largeRetentionCustom) >= 24)) || (defaultRetention === "custom" && !(Number(defaultRetentionCustom) >= 24))) {
      toast.addToast("Custom retention must be at least 24 hours.", "error")
      return
    }
    setSaving(true)
    try {
      const retentionValue = (mode: string, custom: string): number => {
        if (mode === "unlimited") return 0
        if (mode === "custom") return Math.trunc(Number(custom))
        return Number(mode)
      }
      const body = {
        defaultQuotaBytes: Math.round(Number(quotaGb) * GB),
        maxUploadBytes: Math.round(Number(maxUploadGb) * GB),
        largeFileThresholdBytes: Math.max(1, Math.round(Number(largeThresholdMb) * MB)),
        largeFileRetentionHours: retentionValue(largeRetention, largeRetentionCustom),
        defaultRetentionHours: retentionValue(defaultRetention, defaultRetentionCustom),
        defaultVisibility: visibility,
        blockedMimeTypes: blocked,
      }
      await patch("/api/admin/settings", body)
      toast.addToast("Settings saved", "success")
      await load()
      void onSaved()
    } catch (err) {
      if (isLocked(err)) return onLocked()
      toast.addToast(err instanceof ApiError ? err.message : "Could not save settings.", "error")
    } finally {
      setSaving(false)
    }
  }

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center py-16 text-xs text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Loading settings…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AdminSection title="Global storage policy" description="New accounts inherit these values. Per-user overrides win.">
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Default quota (GB)</label>
            <Input type="number" min={0} step="0.5" value={quotaGb} onChange={(event) => setQuotaGb(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Max single upload (GB)</label>
            <Input type="number" min={0} step="0.5" value={maxUploadGb} onChange={(event) => setMaxUploadGb(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Large file threshold (MB)</label>
            <Input type="number" min={1} value={largeThresholdMb} onChange={(event) => setLargeThresholdMb(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Default visibility</label>
            <Select value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)}>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Large file retention (over threshold)</label>
            <RetentionSelect
              value={largeRetention}
              onChange={setLargeRetention}
              presets={presets}
              customHours={largeRetentionCustom}
              onCustomHours={setLargeRetentionCustom}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Default retention (small files)</label>
            <RetentionSelect
              value={defaultRetention}
              onChange={setDefaultRetention}
              presets={presets}
              customHours={defaultRetentionCustom}
              onCustomHours={setDefaultRetentionCustom}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-medium">Blocked MIME types</label>
            <Textarea
              value={blocked}
              onChange={(event) => setBlocked(event.target.value)}
              className="min-h-20 font-mono text-[11px]"
              placeholder="image/svg+xml,text/html"
            />
            <p className="text-[11px] text-muted-foreground">Comma-separated. Matching uploads are rejected with 415.</p>
          </div>
        </div>
        <div className="flex justify-end border-t border-border px-4 py-3">
          <Button size="sm" onClick={() => void save()} disabled={saving || (largeRetention === "custom" && !(Number(largeRetentionCustom) >= 24)) || (defaultRetention === "custom" && !(Number(defaultRetentionCustom) >= 24))} className="gap-1.5">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Save settings
          </Button>
        </div>
      </AdminSection>

      <AdminSection title="System" description="Runtime wiring reported by the gateway (no secrets).">
        <div className="divide-y divide-border text-xs">
          {system &&
            Object.entries(system)
              .filter(([, value]) => value === null || typeof value !== "object")
              .map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <span className="text-muted-foreground">{key}</span>
                  <span className="truncate font-mono text-[11px]">{String(value ?? "—")}</span>
                </div>
              ))}
          {system && typeof system.bunny === "object" && system.bunny !== null && (
            <div className="px-4 py-3">
              <p className="text-[11px] font-medium">Bunny</p>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-muted/40 p-2 font-mono text-[10px]">
                {JSON.stringify(system.bunny, null, 2)}
              </pre>
            </div>
          )}
          {system && typeof system.s3 === "object" && system.s3 !== null && (
            <div className="px-4 py-3">
              <p className="text-[11px] font-medium">S3</p>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-muted/40 p-2 font-mono text-[10px]">
                {JSON.stringify(system.s3, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </AdminSection>
    </div>
  )
}

// ---------------------------------------------------------------------------

function AuditTab({ onLocked }: { onLocked: () => void }) {
  const toast = useToast()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [actionFilter, setActionFilter] = useState("")
  const [action, setAction] = useState("")
  const [loading, setLoading] = useState(true)
  const limit = 40

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await get<{ entries: AuditEntry[]; total: number }>("/api/admin/audit", { limit, offset, action })
      setEntries(data.entries)
      setTotal(data.total)
    } catch (err) {
      if (isLocked(err)) return onLocked()
      toast.addToast(err instanceof ApiError ? err.message : "Could not load the audit log.", "error")
    } finally {
      setLoading(false)
    }
  }, [action, limit, offset, onLocked, toast])

  useEffect(() => {
    const timer = setTimeout(() => {
      setAction(actionFilter.trim())
      setOffset(0)
    }, 300)
    return () => clearTimeout(timer)
  }, [actionFilter])

  useEffect(() => {
    void load()
  }, [load])

  const pages = Math.max(1, Math.ceil(total / limit))
  const page = Math.floor(offset / limit) + 1

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} placeholder="Filter by action…" className="pl-8" />
        </div>
        <p className="text-xs text-muted-foreground">{total} events</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-xs text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Loading audit log…
          </div>
        ) : entries.length === 0 ? (
          <p className="px-4 py-16 text-center text-xs text-muted-foreground">No events.</p>
        ) : (
          <div className="divide-y divide-border">
            {entries.map((entry) => (
              <details key={entry.id} className="group px-4 py-2.5">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-xs">
                  <span className="font-medium">{entry.action}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {entry.actorEmail || "system"}
                    {entry.targetType && ` · ${entry.targetType}`}
                    {entry.targetId && ` · ${entry.targetId.slice(0, 8)}`}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
                </summary>
                <div className="mt-2 grid gap-1 rounded-lg bg-muted/30 p-2 text-[10px] text-muted-foreground">
                  <span>IP: {entry.ip || "—"}</span>
                  <span className="truncate">UA: {entry.ua || "—"}</span>
                  {entry.meta && <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono">{JSON.stringify(entry.meta, null, 2)}</pre>}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page} of {pages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset <= 0} onClick={() => setOffset((value) => Math.max(0, value - limit))}>
              <ChevronLeft className="size-3.5" /> Previous
            </Button>
            <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset((value) => value + limit)}>
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}