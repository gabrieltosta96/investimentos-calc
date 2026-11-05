import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA: instalável no celular e funciona offline (ver public/sw.js). Só no build, para não atrapalhar o dev server.
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js')
