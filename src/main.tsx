import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ThemeFlowSaasEnhancer from './ThemeFlowSaasEnhancer'
import './styles.css'
import './themeFlowSaas.css'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <ThemeFlowSaasEnhancer />
  </React.StrictMode>,
)
