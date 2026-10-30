import { Link } from "react-router"
import { Page } from "@/components/layout/Page"
import { Button } from "@/components/ui/button"
import { VoidLogo } from "@/components/VoidLogo"

export function NotFoundPage() {
  return (
    <Page centered className="h-full">
      <div className="space-y-6 text-center">
        <VoidLogo size="lg" className="justify-center" />
        <div className="space-y-2">
          <p className="font-mono text-xs text-muted-foreground">404</p>
          <h1 className="text-2xl font-semibold tracking-tight">This link does not point anywhere.</h1>
          <p className="text-sm text-muted-foreground">The page may have moved, or the file link has expired.</p>
        </div>
        <Button asChild>
          <Link to="/files">Back to files</Link>
        </Button>
      </div>
    </Page>
  )
}