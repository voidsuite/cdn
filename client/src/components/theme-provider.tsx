/* eslint-disable react-refresh/only-export-components */
import * as React from "react"
import {
  applyAppearance,
  isAccent,
  isTheme,
  readAppearance,
  resolveTheme,
  writeAppearance,
  type AccentId,
  type ResolvedTheme,
  type Theme,
} from "@/lib/appearance"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  disableTransitionOnChange?: boolean
}

type ThemeProviderState = {
  theme: Theme
  accent: AccentId
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
  setAccent: (accent: AccentId) => void
}

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)"

const ThemeProviderContext = React.createContext<ThemeProviderState | undefined>(undefined)

function disableTransitionsTemporarily() {
  const style = document.createElement("style")
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;transition:none!important}",
    ),
  )
  document.head.appendChild(style)

  return () => {
    window.getComputedStyle(document.body)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        style.remove()
      })
    })
  }
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey: _storageKey,
  disableTransitionOnChange = true,
  ...props
}: ThemeProviderProps) {
  const initial = React.useMemo(() => readAppearance(), [])
  const [theme, setThemeState] = React.useState<Theme>(initial.theme ?? defaultTheme)
  const [accent, setAccentState] = React.useState<AccentId>(initial.accent)

  const setTheme = React.useCallback((nextTheme: Theme) => {
    writeAppearance({ theme: nextTheme, accent })
    setThemeState(nextTheme)
  }, [accent])

  const setAccent = React.useCallback((nextAccent: AccentId) => {
    writeAppearance({ theme, accent: nextAccent })
    setAccentState(nextAccent)
  }, [theme])

  React.useEffect(() => {
    const restoreTransitions = disableTransitionOnChange ? disableTransitionsTemporarily() : null
    applyAppearance({ theme, accent })
    if (restoreTransitions) restoreTransitions()
  }, [theme, accent, disableTransitionOnChange])

  React.useEffect(() => {
    if (theme !== "system") return undefined
    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY)
    const handleChange = () => applyAppearance({ theme: "system", accent })
    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [theme, accent])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return
      if (event.key.toLowerCase() !== "d") return

      const nextTheme = resolveTheme(theme) === "dark" ? "light" : "dark"
      writeAppearance({ theme: nextTheme, accent })
      setThemeState(nextTheme)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [theme, accent])

  // Keep same-origin tabs in sync (cookie syncs across *.voidsuite.cc on load).
  React.useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return
      if (event.key !== "theme" && event.key !== "void-accent") return
      const next = readAppearance()
      setThemeState(isTheme(next.theme) ? next.theme : defaultTheme)
      if (isAccent(next.accent)) setAccentState(next.accent)
    }
    window.addEventListener("storage", handleStorageChange)
    return () => window.removeEventListener("storage", handleStorageChange)
  }, [defaultTheme])

  const resolvedTheme = resolveTheme(theme)

  const value = React.useMemo(
    () => ({ theme, accent, resolvedTheme, setTheme, setAccent }),
    [theme, accent, resolvedTheme, setTheme, setAccent],
  )

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = React.useContext(ThemeProviderContext)
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}