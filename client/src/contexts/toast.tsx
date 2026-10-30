/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import { cn } from "@/lib/utils"

interface Toast {
  id: string
  message: string
  type: "success" | "error" | "info"
  duration?: number
}

interface ToastContextType {
  addToast: (message: string, type?: Toast["type"], duration?: number) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within ToastProvider")
  return ctx
}

const icons: Record<Toast["type"], string> = {
  success: "M20 6L9 17l-5-5",
  error: "M18 6L6 18M6 6l12 12",
  info: "M12 16v-4M12 8h.01",
}

const typeStyles: Record<Toast["type"], string> = {
  success: "border-green-500/35 bg-green-500/10 text-green-600 dark:text-green-400",
  error: "border-destructive/35 bg-destructive/10 text-destructive dark:text-destructive/90",
  info: "border-border bg-card text-foreground",
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((message: string, type: Toast["type"] = "info", duration = 4000) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { id, message, type, duration }])
  }, [])

  const remove = (id: string) => {
    setToasts((prev) => {
      const next = prev.filter((t) => t.id !== id)
      return next
    })
  }

  // Auto-remove toast after its duration
  useEffect(() => {
    const timers: Record<string, ReturnType<typeof setTimeout>> = {}
    toasts.forEach((t) => {
      timers[t.id] = setTimeout(() => remove(t.id), t.duration ?? 4000)
    })
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t))
    }
  }, [toasts])

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            data-toast-dismissible
            className={cn(
              "pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-xl transition-all duration-200 ease-out",
              "data-[removing]:opacity-0 data-[removing]:translate-y-4 data-[removing]:scale-95",
              "data-[removing]:border-transparent data-[removing]:shadow-none",
              typeStyles[t.type],
            )}
          >
            <div className="relative mt-0.5 shrink-0">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cn("size-4 shrink-0", t.type === "success" ? "text-green-500" : t.type === "error" ? "text-destructive" : "text-muted-foreground")}
              >
                <path d={icons[t.type]} />
              </svg>
              {t.type === "success" && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="size-4 text-green-600 dark:text-green-400 opacity-0 transition-opacity duration-200">
                    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </div>
            <div className="toast-progress"
              style={{
                backgroundColor:
                  t.type === "success" ? "var(--green-500, #22c55e)" :
                  t.type === "error" ? "var(--destructive)" :
                  "var(--muted-foreground)",
              }}
            />
            <p className="flex-1 text-xs leading-snug">{t.message}</p>
            <button
              onClick={() => remove(t.id)}
              className={cn(
                "text-current opacity-40 hover:opacity-100 transition-opacity shrink-0 ml-1",
                t.type === "success" ? "text-green-500" : t.type === "error" ? "text-destructive" : "text-muted-foreground",
              )}
              aria-label="Dismiss"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
