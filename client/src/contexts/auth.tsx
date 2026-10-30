/* eslint-disable react-refresh/only-export-components */
import * as React from "react"
import { get, post, startLogin } from "@/lib/api"
import type { User } from "@/lib/types"

interface AuthContextValue {
  user: User | null
  loading: boolean
  isAdmin: boolean
  login: () => Promise<void>
  refresh: () => Promise<User | null>
  logout: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null)
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async (): Promise<User | null> => {
    try {
      const data = await get<{ user: User }>("/api/auth/me")
      setUser(data.user)
      return data.user
    } catch {
      setUser(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    const onUnauthorized = () => setUser(null)
    window.addEventListener("voidcdn:unauthorized", onUnauthorized)
    return () => window.removeEventListener("voidcdn:unauthorized", onUnauthorized)
  }, [])

  const login = React.useCallback(async () => {
    await startLogin()
  }, [])

  const logout = React.useCallback(async () => {
    try {
      await post("/api/auth/logout")
    } catch {
      /* clear locally regardless */
    }
    setUser(null)
  }, [])

  const value = React.useMemo<AuthContextValue>(
    () => ({ user, loading, isAdmin: user?.isAdmin === true || user?.role === "admin", login, refresh, logout }),
    [user, loading, login, refresh, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}