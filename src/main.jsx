import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './pages';
import './styles.css';

// Register service worker for offline support
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        // Check for updates every 30 min
        setInterval(() => reg.update(), 30 * 60 * 1000);
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available — could show a toast here
              console.log('[NutriOPS] Nova versão disponível.');
            }
          });
        });
      })
      .catch((err) => console.warn('[NutriOPS] SW registration failed:', err));
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
