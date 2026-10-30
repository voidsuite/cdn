import { useState } from "react"
import { cn } from "@/lib/utils"

const apps = [
  { name: "Auth", href: "https://auth.voidsuite.cc", icon: "◉", desc: "Account & security" },
  { name: "Board", href: "https://board.voidsuite.cc", icon: "▦", desc: "Kanban boards" },
  { name: "Docs", href: "https://docs.voidsuite.cc", icon: "▤", desc: "Documents" },
  { name: "Draw", href: "https://draw.stwupid.tech", icon: "✎", desc: "Whiteboard" },
  { name: "Sheets", href: "https://sheets.voidsuite.cc", icon: "▦▦", desc: "Spreadsheets" },
  { name: "CDN", href: "https://cdn.voidsuite.cc", icon: "☁", desc: "Files & share links" },
  { name: "Mail", href: "https://mail.stwupid.tech", icon: "✉", desc: "Email" },
  { name: "Feedback", href: "https://feedback.voidsuite.cc", icon: "💬", desc: "Support" },
  { name: "2FA", href: "https://2fa.voidsuite.cc", icon: "🔐", desc: "Two-factor authentication" },
]

export function AppSwitcher({ current = "CDN" }: { current?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
        title="Switch apps"
        aria-label="Switch apps"
        aria-expanded={open}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="opacity-70">
          <circle cx="4" cy="4" r="1.5" />
          <circle cx="8" cy="4" r="1.5" />
          <circle cx="12" cy="4" r="1.5" />
          <circle cx="4" cy="8" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="12" cy="8" r="1.5" />
          <circle cx="4" cy="12" r="1.5" />
          <circle cx="8" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-80 animate-scale-in rounded-xl border bg-popover shadow-xl">
            <div className="border-b p-3">
              <p className="text-sm font-medium">Void Apps</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Switch between apps</p>
            </div>
            <div className="grid grid-cols-3 gap-1 p-2">
              {apps.map((app) => (
                <a
                  key={app.name}
                  href={app.href}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg p-2 transition-colors hover:bg-muted/50",
                    app.name === current && "bg-muted/60",
                  )}
                  title={app.desc}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/60 text-lg">{app.icon}</div>
                  <span className="text-xs">{app.name}</span>
                </a>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}