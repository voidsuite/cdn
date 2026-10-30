import * as React from "react"
import { cn } from "@/lib/utils"

interface PageProps {
  children: React.ReactNode
  className?: string
  /** When true, centers the page content in a narrow card (auth pages). */
  centered?: boolean
}

export function Page({ children, className, centered = false }: PageProps) {
  return (
    <div
      className={cn(
        "min-h-full",
        centered
          ? "flex items-center justify-center p-4 sm:p-6"
          : "animate-page-in",
        className,
      )}
    >
      {centered ? (
        <div className="w-full max-w-sm space-y-8">{children}</div>
      ) : (
        <main className="mx-auto max-w-2xl space-y-10 px-6 py-10 sm:px-8 sm:py-14">{children}</main>
      )}
    </div>
  )
}

export interface PageHeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  )
}

export interface SectionProps {
  title?: string
  description?: string
  children: React.ReactNode
  className?: string
  padded?: boolean
}

export function Section({ title, description, children, className, padded = true }: SectionProps) {
  return (
    <section className={cn("space-y-3", className)}>
      {(title || description) && (
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
      <div
        className={cn(
          "rounded-2xl border border-border bg-card overflow-hidden",
          padded ? "divide-y divide-border" : "",
        )}
      >
        {children}
      </div>
    </section>
  )
}

export interface CardRowProps {
  children: React.ReactNode
  className?: string
}

export function CardRow({ children, className }: CardRowProps) {
  return (
    <div className={cn("flex items-center justify-between px-4 py-3", className)}>
      {children}
    </div>
  )
}

export interface CardCellProps {
  children: React.ReactNode
  label?: string
  mono?: boolean
  className?: string
}

export function CardCell({ children, label, mono, className }: CardCellProps) {
  return (
    <div className={cn("flex items-center justify-between px-4 py-3", className)}>
      {label ? (
        <>
          <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
          <span className={cn("text-sm", mono && "font-mono text-xs text-muted-foreground")}>{children}</span>
        </>
      ) : (
        <span className={cn("text-sm", mono && "font-mono text-xs text-muted-foreground")}>{children}</span>
      )}
    </div>
  )
}
