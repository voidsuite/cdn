import * as React from "react"

/**
 * Edge-to-edge application frame. The app window fills the viewport so it
 * touches every corner; the routed content sits in a rounded inset well.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-frame">
      {children}
    </div>
  )
}