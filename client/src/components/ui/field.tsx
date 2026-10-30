import * as React from "react"
import { cn } from "@/lib/utils"

interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string
  description?: string
  error?: string
  required?: boolean
}

const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  ({ className, label, description, error, required, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("space-y-2", className)} {...props}>
        {(label || description) && (
          <div className="space-y-1">
            {label && (
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                {label}
                {required && <span className="ml-1 text-destructive">*</span>}
              </label>
            )}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
        )}
        {children}
        {error && <p className="text-xs text-destructive animate-slide-down">{error}</p>}
      </div>
    )
  }
)
Field.displayName = "Field"

export { Field }
