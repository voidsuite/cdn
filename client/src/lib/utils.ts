import { type NavigateFunction } from "react-router"
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function safeRedirect(navigate: NavigateFunction, redirect: string) {
  // Only allow same-origin relative paths. Rejects absolute URLs (open
  // redirect) and protocol-relative URLs like //evil.example.
  if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
    navigate(redirect)
  } else {
    navigate('/dashboard')
  }
}
