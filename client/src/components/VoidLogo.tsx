import { cn } from "@/lib/utils"

type LogoSize = "sm" | "md" | "lg"

const sizes: Record<LogoSize, { box: string; icon: string; text: string }> = {
  sm: { box: "size-7 rounded-lg", icon: "size-4", text: "text-sm" },
  md: { box: "size-9 rounded-xl", icon: "size-5", text: "text-base" },
  lg: { box: "size-12 rounded-2xl", icon: "size-6", text: "text-lg" },
}

export function VoidLogo({
  size = "sm",
  showWordmark = true,
  className,
}: {
  size?: LogoSize
  showWordmark?: boolean
  className?: string
}) {
  const s = sizes[size]
  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <span
        className={cn(
          "relative flex shrink-0 items-center justify-center bg-primary text-primary-foreground shadow-sm shadow-primary/30",
          s.box,
        )}
      >
        <svg viewBox="0 0 24 24" fill="none" className={s.icon} aria-hidden="true">
          <path
            d="M7.5 18.5h9.25a3.75 3.75 0 0 0 .6-7.45A5.25 5.25 0 0 0 7.1 9.6a4.45 4.45 0 0 0 .4 8.9Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M12 12.4v5.4m0-5.4-2 2m2-2 2 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {showWordmark && (
        <span className={cn("font-semibold tracking-tight", s.text)}>
          Void <span className="text-muted-foreground">CDN</span>
        </span>
      )}
    </span>
  )
}