import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { App } from './App'
import './index.css'

// The operator dashboard is its own bundle, so the mini app never downloads it.
const AdminApp = lazy(() => import('./pages/admin/admin-app').then((m) => ({ default: m.AdminApp })))
const DevelopersApp = lazy(() => import('./pages/developers/developers-app').then((m) => ({ default: m.DevelopersApp })))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={null}>
              <AdminApp />
            </Suspense>
          }
        />
        <Route
          path="/developers/*"
          element={
            <Suspense fallback={null}>
              <DevelopersApp />
            </Suspense>
          }
        />
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
