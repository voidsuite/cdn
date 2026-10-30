import { Component, type ReactNode } from "react"
import { Link } from "react-router"
import { Button } from "@/components/ui/button"
import { VoidLogo } from "@/components/VoidLogo"

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-full items-center justify-center p-6">
          <div className="w-full max-w-xs space-y-6 text-center">
            <VoidLogo size="md" />
            <div className="space-y-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto size-12 text-destructive">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <h1 className="text-lg font-semibold">Something went wrong</h1>
              <p className="text-sm text-muted-foreground">
                {this.state.error?.message || "An unexpected error occurred."}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={() => window.location.reload()}>
                Reload page
              </Button>
              <Button variant="ghost" asChild>
                <Link to="/dashboard">Go to Dashboard</Link>
              </Button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
