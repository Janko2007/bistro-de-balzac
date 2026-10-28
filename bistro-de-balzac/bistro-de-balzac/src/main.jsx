import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'

import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import './index.css'

// Service worker — nova verzija se preuzima u pozadini i odmah primenjuje.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    // Proveri da li postoji novija verzija na svakih sat vremena.
    if (registration) {
      setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000)
    }
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
