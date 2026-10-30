import { cn } from "@/lib/utils"

type SkeletonVariant = "default" | "shimmer" | "pulse"

interface SkeletonProps extends React.ComponentProps<"div"> {
  className?: string
  variant?: SkeletonVariant
}

export function Skeleton({ className, variant = "shimmer", ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      data-variant={variant}
      className={cn(
        "overflow-hidden",
        variant === "shimmer" && "skeleton-shimmer rounded-md",
        variant === "pulse" && "animate-pulse rounded-md bg-muted",
        variant === "default" && "animate-pulse rounded-md bg-muted",
        className,
      )}
      {...props}
    />
  )
}

export function SkeletonText({ className, ...props }: React.ComponentProps<"div"> & { lines?: number }) {
  const lines = Array.from({ length: props.lines ?? 3 }, (_, i) => i)
  return (
    <div className={cn("space-y-2", className)} {...props}>
      {lines.map((i) => (
        <div
          key={i}
          className={cn(
            "h-3 rounded-md",
            i === lines.length - 1 ? "w-40" : "w-full",
            "skeleton-shimmer",
          )}
        />
      ))}
    </div>
  )
}

export function SkeletonAvatar({ className, ...props }: React.ComponentProps<"div"> & { size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "size-8", md: "size-10", lg: "size-14" }
  return (
    <div
      className={cn("rounded-full skeleton-shimmer", sizes[props.size ?? "md"], className)}
      {...props}
    />
  )
}

export function SkeletonCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-4",
        className,
      )}
      {...props}
    />
  )
}

export function SkeletonStat({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "space-y-1.5 rounded-2xl border border-border bg-card p-4",
        className,
      )}
      {...props}
    />
  )
}
