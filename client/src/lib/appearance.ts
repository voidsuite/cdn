/**
 * Global appearance: theme mode + accent colour.
 *
 * Settings are shared across every VoidSuite app (*.voidsuite.cc) through a
 * cookie scoped to the parent domain, so changing them in VoidAuth also
 * applies to VoidCDN and Void Links on the next page load.
 */

export type Theme = "dark" | "light" | "system"
export type ResolvedTheme = "dark" | "light"
export type AccentId = "mono" | "violet" | "blue" | "emerald" | "amber" | "rose"

export const THEME_VALUES: Theme[] = ["dark", "light", "system"]

export interface AccentPalette {
  primary: string
  primaryForeground: string
  brandHover: string
  glow: string
}

export interface AccentPreset {
  id: AccentId
  label: string
  swatch: string
  light: AccentPalette
  dark: AccentPalette
}

/** `mono` keeps each app's own default tokens. */
export const ACCENTS: AccentPreset[] = [
  {
    id: "mono",
    label: "Mono",
    swatch: "#1c1917",
    light: { primary: "", primaryForeground: "", brandHover: "", glow: "" },
    dark: { primary: "", primaryForeground: "", brandHover: "", glow: "" },
  },
  {
    id: "violet",
    label: "Violet",
    swatch: "#8b5cf6",
    light: { primary: "#6d28d9", primaryForeground: "#faf5ff", brandHover: "#5b21b6", glow: "rgb(109 40 217 / 0.25)" },
    dark: { primary: "#a78bfa", primaryForeground: "#1c1917", brandHover: "#c4b5fd", glow: "rgb(167 139 250 / 0.3)" },
  },
  {
    id: "blue",
    label: "Blue",
    swatch: "#3b82f6",
    light: { primary: "#1d4ed8", primaryForeground: "#eff6ff", brandHover: "#1e40af", glow: "rgb(29 78 216 / 0.25)" },
    dark: { primary: "#60a5fa", primaryForeground: "#151211", brandHover: "#93c5fd", glow: "rgb(96 165 250 / 0.3)" },
  },
  {
    id: "emerald",
    label: "Emerald",
    swatch: "#10b981",
    light: { primary: "#047857", primaryForeground: "#ecfdf5", brandHover: "#065f46", glow: "rgb(4 120 87 / 0.25)" },
    dark: { primary: "#34d399", primaryForeground: "#151211", brandHover: "#6ee7b7", glow: "rgb(52 211 153 / 0.3)" },
  },
  {
    id: "amber",
    label: "Amber",
    swatch: "#f59e0b",
    light: { primary: "#b45309", primaryForeground: "#fffbeb", brandHover: "#92400e", glow: "rgb(180 83 9 / 0.25)" },
    dark: { primary: "#fbbf24", primaryForeground: "#151211", brandHover: "#fcd34d", glow: "rgb(251 191 36 / 0.3)" },
  },
  {
    id: "rose",
    label: "Rose",
    swatch: "#f43f5e",
    light: { primary: "#be123c", primaryForeground: "#fff1f2", brandHover: "#9f1239", glow: "rgb(190 18 60 / 0.25)" },
    dark: { primary: "#fb7185", primaryForeground: "#151211", brandHover: "#fda4af", glow: "rgb(251 113 133 / 0.3)" },
  },
]

const COOKIE_NAME = "void_appearance"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365
const THEME_STORAGE_KEY = "theme"
const ACCENT_STORAGE_KEY = "void-accent"

export interface Appearance {
  theme: Theme
  accent: AccentId
}

export function isTheme(value: string | null): value is Theme {
  return value !== null && THEME_VALUES.includes(value as Theme)
}

export function isAccent(value: string | null): value is AccentId {
  return value !== null && ACCENTS.some((accent) => accent.id === value)
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme
}

function cookieDomain(): string {
  if (typeof window === "undefined") return ""
  const host = window.location.hostname
  return host === "voidsuite.cc" || host.endsWith(".voidsuite.cc")
    ? "; Domain=.voidsuite.cc"
    : ""
}

function readCookie(): Appearance | null {
  if (typeof document === "undefined") return null
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
  if (!entry) return null

  const value = entry.slice(COOKIE_NAME.length + 1)
  const [theme, accent] = decodeURIComponent(value).split(":")
  return {
    theme: isTheme(theme) ? theme : "system",
    accent: isAccent(accent) ? accent : "mono",
  }
}

export function readAppearance(): Appearance {
  const cookie = readCookie()
  if (cookie) return cookie

  if (typeof localStorage === "undefined") {
    return { theme: "system", accent: "mono" }
  }

  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY)
  const storedAccent = localStorage.getItem(ACCENT_STORAGE_KEY)
  return {
    theme: isTheme(storedTheme) ? storedTheme : "system",
    accent: isAccent(storedAccent) ? storedAccent : "mono",
  }
}

export function writeAppearance(appearance: Appearance): void {
  if (typeof document !== "undefined") {
    document.cookie = `${COOKIE_NAME}=${appearance.theme}:${appearance.accent}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${cookieDomain()}`
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, appearance.theme)
    localStorage.setItem(ACCENT_STORAGE_KEY, appearance.accent)
  } catch {
    /* storage may be unavailable in private mode */
  }
}

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement
  const resolved = resolveTheme(appearance.theme)

  root.classList.remove("light", "dark")
  root.classList.add(resolved)
  root.style.colorScheme = resolved

  const preset = ACCENTS.find((accent) => accent.id === appearance.accent) ?? ACCENTS[0]
  const palette = resolved === "dark" ? preset.dark : preset.light

  const properties: Array<[string, string]> = [
    ["--primary", palette.primary],
    ["--primary-foreground", palette.primaryForeground],
    ["--brand", palette.primary],
    ["--brand-foreground", palette.primaryForeground],
    ["--brand-hover", palette.brandHover],
    ["--brand-glow", palette.glow],
    ["--sidebar-primary", palette.primary],
    ["--sidebar-primary-foreground", palette.primaryForeground],
  ]

  for (const [property, value] of properties) {
    if (value) root.style.setProperty(property, value)
    else root.style.removeProperty(property)
  }
}