import { createBrowserRouter, Navigate, RouterProvider } from "react-router"
import { AuthProvider } from "@/contexts/auth"
import { AppShell } from "@/components/layout/AppShell"
import { AppLayout } from "@/components/layout/AppLayout"
import { LoginPage } from "@/pages/LoginPage"
import { OAuthCallbackPage } from "@/pages/OAuthCallbackPage"
import { FilesPage } from "@/pages/FilesPage"
import { SettingsPage } from "@/pages/SettingsPage"
import { AdminPage } from "@/pages/AdminPage"
import { NotFoundPage } from "@/pages/NotFoundPage"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { ThemeProvider } from "@/components/theme-provider"
import { ToastProvider } from "@/contexts/toast"

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/oauth/callback", element: <OAuthCallbackPage /> },
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/files" replace /> },
      { path: "files", element: <FilesPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "admin", element: <AdminPage /> },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
])

export function App() {
  return (
    <AppShell>
      <RouterProvider router={router} />
    </AppShell>
  )
}

export default function Root() {
  return (
    <ThemeProvider defaultTheme="dark">
      <AuthProvider>
        <ErrorBoundary>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ErrorBoundary>
      </AuthProvider>
    </ThemeProvider>
  )
}