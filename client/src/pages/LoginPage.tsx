import { useEffect, useState } from "react"
import { Navigate, useLocation } from "react-router"
import { ArrowRight, Link2, Lock, ShieldCheck, UploadCloud } from "lucide-react"
import { useAuth } from "@/contexts/auth"
import { Button } from "@/components/ui/button"
import { VoidLogo } from "@/components/VoidLogo"
import { Page } from "@/components/layout/Page"
import { LoadingScreen } from "@/components/layout/AppLayout"

const features = [
  { icon: UploadCloud, title: "Drop anything", text: "Up to 1 GB of storage per account, resumes with a single retry." },
  { icon: Link2, title: "Share clean links", text: "Every upload gets a random, readable URL on storage.void.co.im." },
  { icon: Lock, title: "Private when you need it", text: "Link-only by default, or owner-only for each file." },
]

export function LoginPage() {
  const { user, loading, login } = useAuth()
  const location = useLocation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get("error")) setError(params.get("error_description") || params.get("error"))
  }, [location.search])

  if (loading) return <LoadingScreen label="Checking your session…" />
  if (user) return <Navigate to="/files" replace />

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await login()
    } catch (err) {
      setBusy(false)
      setError((err as Error).message || "Could not reach VoidAuth.")
    }
  }

  return (
    <Page centered className="h-full">
      <div className="space-y-8">
        <div className="space-y-5 text-center">
          <VoidLogo size="lg" className="justify-center" />
          <div className="space-y-2">
            <h1 className="text-balance text-3xl font-semibold tracking-tight">Your files, everywhere.</h1>
            <p className="mx-auto max-w-sm text-balance text-sm leading-relaxed text-muted-foreground">
              Upload once, share a link, and keep the original safe. Void CDN is part of the Void suite and signs you in with your VoidAuth account.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {features.map((feature) => (
            <div key={feature.title} className="flex items-start gap-3 rounded-2xl border border-border bg-card px-4 py-3">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground">
                <feature.icon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{feature.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{feature.text}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {error && (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">
              {error}
            </p>
          )}
          <Button className="h-11 w-full text-sm" onClick={() => void start()} disabled={busy}>
            {busy ? "Redirecting to VoidAuth…" : "Continue with VoidAuth"}
            {!busy && <ArrowRight className="size-4" />}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            You will sign in on auth.voidsuite.cc. Your password never touches this app.
          </p>
        </div>
      </div>
    </Page>
  )
}