import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ManualThemeManager from './ManualThemeManager'
import './styles.css'
import './themeFlowSaas.css'
import './mobileResponsive.css'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <ManualThemeManager />
  </React.StrictMode>,
)
