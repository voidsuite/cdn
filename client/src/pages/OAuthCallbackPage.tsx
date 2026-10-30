import { useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router"
import { useAuth } from "@/contexts/auth"
import { post } from "@/lib/api"
import { Page } from "@/components/layout/Page"
import { Button } from "@/components/ui/button"
import { VoidLogo } from "@/components/VoidLogo"

export function OAuthCallbackPage() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const params = new URLSearchParams(window.location.search)
    const oauthError = params.get("error")
    if (oauthError) {
      setError(params.get("error_description") || oauthError)
      return
    }

    const code = params.get("code")
    const state = params.get("state")
    if (!code || !state) {
      setError("The sign-in response was missing its code. Please try again.")
      return
    }

    post<{ user: unknown }>("/api/auth/exchange", { code, state, keepMeLoggedIn: true })
      .then(async () => {
        await refresh()
        const returnTo = sessionStorage.getItem("voidcdn:returnTo")
        sessionStorage.removeItem("voidcdn:returnTo")
        navigate(returnTo && returnTo.startsWith("/") ? returnTo : "/files", { replace: true })
      })
      .catch((err: Error) => setError(err.message || "Could not finish signing in."))
  }, [navigate, refresh])

  return (
    <Page centered className="h-full">
      <div className="space-y-6 text-center">
        <VoidLogo size="lg" className="justify-center" />
        {error ? (
          <>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold">Sign-in failed</h1>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Button asChild>
                <Link to="/login">Try again</Link>
              </Button>
              <Button variant="ghost" asChild>
                <Link to="/files">Go to files</Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold">Finishing sign-in…</h1>
              <p className="text-sm text-muted-foreground">Exchanging your VoidAuth code for a secure session.</p>
            </div>
            <svg className="mx-auto size-5 animate-spin text-muted-foreground" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </>
        )}
      </div>
    </Page>
  )
}