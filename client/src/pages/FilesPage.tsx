import { useCallback, useEffect, useRef, useState } from "react"
import {
  ChevronDown,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  FolderOpen,
  Link2,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react"
import Dialog from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { useToast } from "@/contexts/toast"
import {
  absoluteUrl,
  copyText,
  del,
  get,
  patch,
  post,
  uploadWithProgress,
  ApiError,
} from "@/lib/api"
import {
  expiryLabel,
  fileExtension,
  fileKind,
  formatBytes,
  formatDate,
  relativeTime,
} from "@/lib/format"
import type {
  FileItem,
  FileStats,
  FilesResponse,
  RuntimeConfig,
  UploadIntentResponse,
  Visibility,
} from "@/lib/types"
import { cn } from "@/lib/utils"

type QueueStatus = "queued" | "uploading" | "finalizing" | "done" | "error"

interface QueueItem {
  id: string
  file: File
  visibility: Visibility
  progress: number
  status: QueueStatus
  error?: string
}

const visibilityMeta: Record<Visibility, { label: string; hint: string; icon: typeof Link2 }> = {
  unlisted: { label: "Unlisted", hint: "Anyone with the link", icon: Link2 },
  private: { label: "Private", hint: "Only you and admins", icon: Lock },
}

const kindIcons: Record<ReturnType<typeof fileKind>, typeof FileText> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  archive: FileArchive,
  code: FileCode2,
  doc: FileText,
  file: FileText,
}

function FileIcon({ file, className }: { file: FileItem; className?: string }) {
  const Icon = kindIcons[fileKind(file.mime, file.name)]
  return (
    <div className={cn("flex items-center justify-center rounded-lg bg-muted/60 text-muted-foreground", className)}>
      <Icon className="size-4" />
    </div>
  )
}

function VisibilityToggle({
  value,
  onChange,
  disabled,
}: {
  value: Visibility
  onChange: (value: Visibility) => void
  disabled?: boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
      {(Object.keys(visibilityMeta) as Visibility[]).map((visibility) => {
        const meta = visibilityMeta[visibility]
        const active = value === visibility
        return (
          <button
            key={visibility}
            type="button"
            disabled={disabled}
            onClick={() => onChange(visibility)}
            className={cn(
              "flex items-center justify-center gap-1 rounded-md px-3 py-1 text-xs transition-colors disabled:opacity-50",
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <meta.icon className="size-3" />
            {meta.label}
          </button>
        )
      })}
    </div>
  )
}

export function FilesPage() {
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)

  const [config, setConfig] = useState<RuntimeConfig | null>(null)
  const [stats, setStats] = useState<FileStats | null>(null)
  const [files, setFiles] = useState<FileItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [type, setType] = useState("all")
  const [sort, setSort] = useState("newest")
  const [visibilityFilter, setVisibilityFilter] = useState("all")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [uploadVisibility, setUploadVisibility] = useState<Visibility>("unlisted")
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [preview, setPreview] = useState<FileItem | null>(null)
  const [editing, setEditing] = useState<FileItem | null>(null)
  const [editName, setEditName] = useState("")
  const [editVisibility, setEditVisibility] = useState<Visibility>("unlisted")
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleting, setDeleting] = useState<FileItem | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const limit = 24
  const maxUpload = stats?.maxUploadBytes ?? null

  const loadStats = useCallback(async () => {
    try {
      setStats(await get<FileStats>("/api/files/stats"))
    } catch {
      /* surfaced by the list request */
    }
  }, [])

  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      const data = await get<FilesResponse>("/api/files", {
        page,
        limit,
        search,
        type,
        sort,
        visibility: visibilityFilter,
      })
      setFiles(data.files)
      setTotal(data.total)
    } catch (err) {
      toast.addToast(err instanceof ApiError ? err.message : "Could not load your files.", "error")
    } finally {
      setLoading(false)
    }
  }, [page, search, sort, toast, type, visibilityFilter])

  useEffect(() => {
    void get<RuntimeConfig>("/api/config")
      .then((data) => {
        setConfig(data)
        setUploadVisibility(data.defaults.defaultVisibility)
      })
      .catch(() => {})
    void loadStats()
  }, [loadStats])

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  const updateQueue = (id: string, patch: Partial<QueueItem>) => {
    setQueue((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const uploadOne = useCallback(
    async (file: File, visibility: Visibility) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      setQueue((current) => [...current, { id, file, visibility, progress: 0, status: "queued" }])

      try {
        updateQueue(id, { status: "uploading" })
        const intent = await post<UploadIntentResponse>("/api/files/intents", {
          name: file.name,
          size: file.size,
          mime: file.type || "application/octet-stream",
          visibility,
        })

        const result = await uploadWithProgress(intent.intent.upload.url, file, intent.intent.upload.headers, {
          withCredentials: intent.intent.mode === "proxy",
          onProgress: (progress) => updateQueue(id, { progress }),
        })

        if (result.status < 200 || result.status >= 300) {
          let message = `Upload failed (${result.status})`
          try {
            const parsed = JSON.parse(result.body) as { error?: string }
            if (parsed.error) message = parsed.error
          } catch {
            /* plain-text body */
          }
          throw new Error(message)
        }

        if (intent.intent.mode === "presigned") {
          updateQueue(id, { status: "finalizing", progress: 100 })
          await post(`/api/files/${intent.file.id}/complete`)
        }

        updateQueue(id, { status: "done", progress: 100 })
        toast.addToast(`${file.name} uploaded`, "success")
        void loadFiles()
        void loadStats()
        setTimeout(() => setQueue((current) => current.filter((item) => item.id !== id)), 4000)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed"
        updateQueue(id, { status: "error", error: message })
        toast.addToast(message, "error")
      }
    },
    [loadFiles, loadStats, toast],
  )

  const handleFiles = useCallback(
    (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList)
      if (incoming.length === 0) return

      const accepted: File[] = []
      for (const file of incoming) {
        if (file.size <= 0) {
          toast.addToast(`${file.name} is empty.`, "error")
          continue
        }
        if (maxUpload !== null && file.size > maxUpload) {
          toast.addToast(`${file.name} is larger than the ${formatBytes(maxUpload)} per-file limit.`, "error")
          continue
        }
        const mime = (file.type || "application/octet-stream").toLowerCase()
        if (config?.blockedMimeTypes.some((blocked) => mime === blocked || mime.startsWith(`${blocked};`))) {
          toast.addToast(`${file.name} uses a blocked file type.`, "error")
          continue
        }
        accepted.push(file)
      }

      if (accepted.length === 0) return
      for (const file of accepted) void uploadOne(file, uploadVisibility)
    },
    [config, maxUpload, toast, uploadOne, uploadVisibility],
  )

  const retry = (item: QueueItem) => {
    setQueue((current) => current.filter((entry) => entry.id !== item.id))
    void uploadOne(item.file, item.visibility)
  }

  const copyLink = async (file: FileItem) => {
    try {
      const data = await get<{ url: string; downloadUrl: string }>(`/api/files/${file.id}/url`)
      const ok = await copyText(absoluteUrl(data.url))
      toast.addToast(ok ? "Link copied" : "Could not copy the link", ok ? "success" : "error")
    } catch (err) {
      toast.addToast(err instanceof ApiError ? err.message : "Could not create a link.", "error")
    }
  }

  const openFile = (file: FileItem) => {
    if (file.visibility === "private" || fileKind(file.mime, file.name) === "image") {
      setPreview(file)
      return
    }
    window.open(absoluteUrl(file.url), "_blank", "noopener,noreferrer")
  }

  const beginEdit = (file: FileItem) => {
    setMenuFor(null)
    setEditing(file)
    setEditName(file.name)
    setEditVisibility(file.visibility)
  }

  const saveEdit = async () => {
    if (!editing) return
    setSavingEdit(true)
    try {
      const data = await patch<{ file: FileItem }>(`/api/files/${editing.id}`, {
        name: editName.trim(),
        visibility: editVisibility,
      })
      setFiles((current) => current.map((item) => (item.id === data.file.id ? data.file : item)))
      setEditing(null)
      toast.addToast("File updated", "success")
      void loadStats()
    } catch (err) {
      toast.addToast(err instanceof ApiError ? err.message : "Could not update the file.", "error")
    } finally {
      setSavingEdit(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeletingBusy(true)
    try {
      await del(`/api/files/${deleting.id}`)
      setFiles((current) => current.filter((item) => item.id !== deleting.id))
      setTotal((value) => Math.max(0, value - 1))
      setDeleting(null)
      toast.addToast("File deleted", "success")
      void loadStats()
      void loadFiles()
    } catch (err) {
      toast.addToast(err instanceof ApiError ? err.message : "Could not delete the file.", "error")
    } finally {
      setDeletingBusy(false)
    }
  }

  const pages = Math.max(1, Math.ceil(total / limit))
  const storagePercent = stats?.storage.percent ?? 0
  const activeFilters = [type !== "all", visibilityFilter !== "all", sort !== "newest"].filter(Boolean).length
  const storageLine = stats
    ? `${formatBytes(stats.storage.used)}${stats.storage.unlimited ? " used" : ` of ${formatBytes(stats.storage.quota ?? 0)}`} · ${stats.files} file${stats.files === 1 ? "" : "s"}${stats.expiringSoon > 0 ? ` · ${stats.expiringSoon} expiring` : ""}`
    : "Loading storage…"

  const previewKind = preview ? fileKind(preview.mime, preview.name) : "file"
  const previewUrl = preview ? absoluteUrl(preview.url) : ""

  const openPicker = () => inputRef.current?.click()

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8 sm:py-8">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) handleFiles(event.target.files)
          event.target.value = ""
        }}
      />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Files</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{storageLine}</p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search"
              className="h-8 w-36 rounded-lg pl-8 text-xs sm:w-48"
            />
          </div>

          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setFiltersOpen((value) => !value)}
              aria-expanded={filtersOpen}
            >
              <SlidersHorizontal className="size-3.5" />
              <span className="hidden sm:inline">Filter</span>
              {activeFilters > 0 && (
                <span className="rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{activeFilters}</span>
              )}
            </Button>
            {filtersOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setFiltersOpen(false)} />
                <div className="absolute right-0 top-full z-40 mt-1.5 w-60 space-y-3 rounded-xl border border-border bg-popover p-3 shadow-lg">
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-muted-foreground">Type</p>
                    <Select
                      value={type}
                      onChange={(event) => {
                        setType(event.target.value)
                        setPage(1)
                      }}
                      className="h-8 rounded-lg text-xs"
                    >
                      <option value="all">All types</option>
                      <option value="image">Images</option>
                      <option value="video">Video</option>
                      <option value="audio">Audio</option>
                      <option value="document">Documents</option>
                      <option value="archive">Archives</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-muted-foreground">Visibility</p>
                    <Select
                      value={visibilityFilter}
                      onChange={(event) => {
                        setVisibilityFilter(event.target.value)
                        setPage(1)
                      }}
                      className="h-8 rounded-lg text-xs"
                    >
                      <option value="all">Any</option>
                      <option value="unlisted">Unlisted</option>
                      <option value="private">Private</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-muted-foreground">Sort</p>
                    <Select
                      value={sort}
                      onChange={(event) => {
                        setSort(event.target.value)
                        setPage(1)
                      }}
                      className="h-8 rounded-lg text-xs"
                    >
                      <option value="newest">Newest</option>
                      <option value="oldest">Oldest</option>
                      <option value="name">Name</option>
                      <option value="size">Largest</option>
                      <option value="expires">Expiry</option>
                    </Select>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <div className="flex">
              <Button size="sm" className="gap-1.5 rounded-r-none" onClick={openPicker}>
                <Upload className="size-3.5" />
                Upload
              </Button>
              <Button
                size="sm"
                className="rounded-l-none border-l-primary-foreground/25 px-1.5"
                onClick={() => setUploadMenuOpen((value) => !value)}
                aria-label="Upload options"
                aria-expanded={uploadMenuOpen}
              >
                <ChevronDown className="size-3.5" />
              </Button>
            </div>
            {uploadMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setUploadMenuOpen(false)} />
                <div className="absolute right-0 top-full z-40 mt-1.5 w-56 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg">
                  <p className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">Upload as</p>
                  {(Object.keys(visibilityMeta) as Visibility[]).map((visibility) => {
                    const meta = visibilityMeta[visibility]
                    const active = uploadVisibility === visibility
                    return (
                      <button
                        key={visibility}
                        type="button"
                        onClick={() => {
                          setUploadVisibility(visibility)
                          setUploadMenuOpen(false)
                        }}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60",
                          active && "bg-muted/60",
                        )}
                      >
                        <meta.icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium">{meta.label}</span>
                          <span className="block text-[10px] text-muted-foreground">{meta.hint}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            storagePercent >= 90 ? "bg-destructive" : storagePercent >= 70 ? "bg-amber-500" : "bg-primary",
          )}
          style={{ width: `${stats?.storage.unlimited || storagePercent <= 0 ? 0 : Math.max(2, storagePercent)}%` }}
        />
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          setDragActive(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragActive(false)
          if (event.dataTransfer.files) handleFiles(event.dataTransfer.files)
        }}
        className={cn(
          "mt-4 flex items-center gap-2.5 rounded-xl border border-dashed px-3.5 py-3 text-xs transition-colors",
          dragActive ? "border-primary bg-primary/5" : "border-border bg-muted/20",
        )}
      >
        <CloudUpload className="size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate text-muted-foreground">
          {dragActive ? (
            "Drop to upload"
          ) : (
            <>
              Drop files here or{" "}
              <button
                type="button"
                onClick={openPicker}
                className="text-foreground underline underline-offset-4 hover:no-underline"
              >
                browse
              </button>
              <span className="hidden sm:inline">
                {" "}
                · {visibilityMeta[uploadVisibility].label.toLowerCase()} by default
              </span>
            </>
          )}
        </p>
        {maxUpload !== null && (
          <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">max {formatBytes(maxUpload)}</span>
        )}
      </div>

      {queue.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {queue.map((item) => (
            <div key={item.id} className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                {item.status === "uploading" || item.status === "finalizing" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : item.status === "done" ? (
                  <CloudUpload className="size-3.5" />
                ) : item.status === "error" ? (
                  <RefreshCw className="size-3.5 text-destructive" />
                ) : (
                  <Upload className="size-3.5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs">{item.file.name}</p>
                  <p className="shrink-0 text-[10px] text-muted-foreground">
                    {item.status === "error"
                      ? "Failed"
                      : item.status === "done"
                        ? "Done"
                        : item.status === "finalizing"
                          ? "Finishing…"
                          : `${item.progress}%`}
                  </p>
                </div>
                <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full transition-all", item.status === "error" ? "bg-destructive" : "bg-primary")}
                    style={{ width: `${item.status === "error" ? 100 : item.progress}%` }}
                  />
                </div>
                {item.error && <p className="mt-1 truncate text-[10px] text-destructive">{item.error}</p>}
              </div>
              {item.status === "error" && (
                <div className="flex shrink-0 gap-0.5">
                  <Button variant="ghost" size="icon-xs" onClick={() => retry(item)} title="Retry">
                    <RefreshCw />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setQueue((current) => current.filter((entry) => entry.id !== item.id))}
                    title="Dismiss"
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <section className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 px-3 py-3">
                <div className="size-9 animate-pulse rounded-lg bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-2.5 w-40 animate-pulse rounded-full bg-muted" />
                  <div className="h-2 w-24 animate-pulse rounded-full bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : files.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <FolderOpen className="size-5" />
            </div>
            <h2 className="mt-3 text-sm font-medium">
              {search || type !== "all" || visibilityFilter !== "all" ? "No matching files" : "No files yet"}
            </h2>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
              {search || type !== "all" || visibilityFilter !== "all"
                ? "Try a different search or clear the filters."
                : "Drop a file above to create your first link."}
            </p>
            {!search && type === "all" && visibilityFilter === "all" && (
              <Button className="mt-4 gap-1.5" size="sm" onClick={openPicker}>
                <Upload className="size-3.5" />
                Upload a file
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {files.map((file, index) => {
              const meta = visibilityMeta[file.visibility]
              return (
                <div
                  key={file.id}
                  className="group relative flex animate-slide-up items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
                  style={{ animationDelay: `${Math.min(index, 8) * 25}ms`, animationFillMode: "backwards" }}
                >
                  {fileKind(file.mime, file.name) === "image" && file.url ? (
                    <button
                      type="button"
                      onClick={() => setPreview(file)}
                      className="size-9 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
                    >
                      <img src={absoluteUrl(file.url)} alt="" loading="lazy" className="size-full object-cover" />
                    </button>
                  ) : (
                    <FileIcon file={file} className="size-9 shrink-0" />
                  )}

                  <button type="button" onClick={() => setPreview(file)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm" title={file.name}>
                      {file.name}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                      <meta.icon className="size-3 shrink-0" />
                      <span className="truncate">
                        {formatBytes(file.size)} · {fileExtension(file.name) || file.mime.split("/").pop() || "file"} ·{" "}
                        {formatDate(file.createdAt)}
                        {file.expiresAt !== null && ` · ${relativeTime(file.expiresAt)}`}
                      </span>
                    </p>
                  </button>

                  <div className="hidden shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
                    <Button variant="ghost" size="icon-xs" onClick={() => void copyLink(file)} title="Copy link">
                      <Copy />
                    </Button>
                    <Button variant="ghost" size="icon-xs" asChild title="Download">
                      <a href={absoluteUrl(file.downloadUrl)} download>
                        <Download />
                      </a>
                    </Button>
                  </div>

                  <div className="relative shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setMenuFor((value) => (value === file.id ? null : file.id))}
                      aria-label="File actions"
                    >
                      <MoreHorizontal />
                    </Button>
                    {menuFor === file.id && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setMenuFor(null)} />
                        <div className="absolute right-0 top-full z-40 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-lg">
                          <button
                            type="button"
                            onClick={() => beginEdit(file)}
                            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted/60"
                          >
                            <Pencil className="size-3" /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMenuFor(null)
                              void copyLink(file)
                            }}
                            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted/60"
                          >
                            <Copy className="size-3" /> Copy link
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMenuFor(null)
                              openFile(file)
                            }}
                            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted/60"
                          >
                            {file.visibility === "private" ? <Lock className="size-3" /> : <ExternalLink className="size-3" />}
                            Open
                          </button>
                          <a
                            href={absoluteUrl(file.downloadUrl)}
                            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted/60"
                            onClick={() => setMenuFor(null)}
                          >
                            <Download className="size-3" /> Download
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              setMenuFor(null)
                              setDeleting(file)
                            }}
                            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="size-3" /> Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            Page {page} of {pages} · {total} files
          </span>
          <div className="flex gap-1.5">
            <Button variant="outline" size="xs" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              Previous
            </Button>
            <Button variant="outline" size="xs" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Preview */}
      <Dialog
        open={!!preview}
        onOpenChange={(open) => !open && setPreview(null)}
        title={preview?.name}
        description={
          preview
            ? `${formatBytes(preview.size)} · ${visibilityMeta[preview.visibility].label} · ${expiryLabel(preview.expiresAt)}`
            : undefined
        }
        className="max-w-3xl"
      >
        {preview && (
          <div className="space-y-4">
            <div className="flex min-h-40 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/30 p-2">
              {previewKind === "image" ? (
                <img src={previewUrl} alt={preview.name} className="max-h-[55vh] w-auto max-w-full rounded-lg object-contain" />
              ) : previewKind === "video" ? (
                <video src={previewUrl} controls className="max-h-[55vh] w-full rounded-lg" />
              ) : previewKind === "audio" ? (
                <audio src={previewUrl} controls className="w-full max-w-md" />
              ) : previewKind === "pdf" ? (
                <iframe src={previewUrl} title={preview.name} className="h-[55vh] w-full rounded-lg bg-background" />
              ) : (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                  <FileIcon file={preview} className="size-14" />
                  <p className="text-xs">Preview is not available for this file type.</p>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div className="rounded-lg border border-border px-2.5 py-1.5">
                <p className="text-[10px] text-muted-foreground">Size</p>
                <p className="font-medium">{formatBytes(preview.size)}</p>
              </div>
              <div className="rounded-lg border border-border px-2.5 py-1.5">
                <p className="text-[10px] text-muted-foreground">Downloads</p>
                <p className="font-medium">{preview.downloads}</p>
              </div>
              <div className="rounded-lg border border-border px-2.5 py-1.5">
                <p className="text-[10px] text-muted-foreground">Uploaded</p>
                <p className="font-medium">{formatDate(preview.createdAt)}</p>
              </div>
              <div className="rounded-lg border border-border px-2.5 py-1.5">
                <p className="text-[10px] text-muted-foreground">Retention</p>
                <p className="font-medium">{preview.retentionLabel}</p>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => void copyLink(preview)} className="gap-1.5">
                <Copy className="size-3.5" /> Copy link
              </Button>
              <Button variant="outline" size="sm" asChild className="gap-1.5">
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" /> Open
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild className="gap-1.5">
                <a href={absoluteUrl(preview.downloadUrl)} download>
                  <Download className="size-3.5" /> Download
                </a>
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Edit */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)} title="Edit file" description="Rename the file or change who can open it.">
        {editing && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Name</label>
              <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
              <p className="text-[11px] text-muted-foreground">Changing the name does not change the storage URL.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Visibility</label>
              <VisibilityToggle value={editVisibility} onChange={setEditVisibility} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void saveEdit()} disabled={savingEdit || !editName.trim()}>
                {savingEdit && <Loader2 className="size-3.5 animate-spin" />}
                Save changes
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Delete */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)} title="Delete file" description="This removes the file from storage and breaks every existing link.">
        {deleting && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
              <FileIcon file={deleting} className="size-9" />
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{deleting.name}</p>
                <p className="text-[11px] text-muted-foreground">{formatBytes(deleting.size)}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>
                Keep file
              </Button>
              <Button variant="destructive" size="sm" onClick={() => void confirmDelete()} disabled={deletingBusy}>
                {deletingBusy && <Loader2 className="size-3.5 animate-spin" />}
                Delete permanently
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </main>
  )
}