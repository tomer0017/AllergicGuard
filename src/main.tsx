import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './app/App.tsx'
import './index.css'
import { registerServiceWorker } from './app/registerServiceWorker.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()
