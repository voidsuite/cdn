import { Navigate, Outlet, useLocation } from "react-router"
import { useAuth } from "@/contexts/auth"
import { TopBar } from "./TopBar"

export function LoadingScreen({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3">
        <svg className="size-6 animate-spin text-muted-foreground" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}

export function AppLayout() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />

  return (
    <>
      <TopBar />
      {/* Content well: inset from the bar and edges, rounded on the inside. */}
      <div className="min-h-0 flex-1 px-2 pb-2 sm:px-2.5 sm:pb-2.5">
        <div className="h-full overflow-y-auto custom-scrollbar rounded-xl border border-border/70 bg-background shadow-inner sm:rounded-2xl">
          <Outlet />
        </div>
      </div>
    </>
  )
}