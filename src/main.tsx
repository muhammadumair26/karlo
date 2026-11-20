import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setupNative } from './lib/native'
import { keepFresh } from './lib/freshness'
import { MobileAppBanner } from './components/MobileAppBanner'

setupNative()
keepFresh()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <MobileAppBanner />
  </StrictMode>,
)
