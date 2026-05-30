import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { ThemeProvider } from './contexts/ThemeContext'
import { ToastProvider } from './contexts/ToastContext'
import App from './App'
import './index.css'
import './i18n'
import { bootstrapCodexAppearance } from './utils/codexAppearance'

// Read the saved Codex appearance + apply classes on <html> before React
// mounts, so codex-themed pages render with the right theme / accent /
// density / radius on the very first paint (no flash of default styling).
bootstrapCodexAppearance()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <ThemeProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ThemeProvider>
      </BrowserRouter>
    </HelmetProvider>
  </React.StrictMode>,
)
