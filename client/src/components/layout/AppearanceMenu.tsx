import { useEffect, useRef, useState } from "react"
import { Check, Palette } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { ACCENTS, type AccentId, type Theme } from "@/lib/appearance"
import { cn } from "@/lib/utils"

const THEME_OPTIONS: Array<{ value: Theme; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
]

/**
 * Compact appearance control for the top bar. Theme and accent are stored in the
 * shared VoidSuite cookie, so changes follow the user to the other apps.
 */
export function AppearanceMenu() {
  const { theme, accent, setTheme, setAccent } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", escape)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label="Appearance settings"
        aria-expanded={open}
      >
        <Palette className="size-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 animate-slide-down rounded-xl border border-border bg-card p-3 shadow-lg">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Theme</p>
          <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/40 p-1">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value)}
                aria-pressed={theme === option.value}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  theme === option.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Accent</p>
          <div className="mt-1.5 grid grid-cols-6 gap-1.5">
            {ACCENTS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setAccent(preset.id as AccentId)}
                title={preset.label}
                aria-label={preset.label}
                aria-pressed={accent === preset.id}
                className={cn(
                  "relative flex size-7 items-center justify-center rounded-full border border-black/10 transition-transform hover:scale-110",
                  accent === preset.id && "ring-2 ring-primary ring-offset-2 ring-offset-card",
                )}
                style={{ backgroundColor: preset.swatch }}
              >
                {accent === preset.id && <Check className="size-3.5 text-white drop-shadow" />}
              </button>
            ))}
          </div>

          <p className="mt-3 text-[10px] text-muted-foreground">Synced across VoidSuite apps.</p>
        </div>
      )}
    </div>
  )
}