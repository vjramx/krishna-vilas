import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from '@/App';
import { AuthProvider } from '@/context/AuthContext';
import '@/index.css';

/**
 * Inside a packaged Android shell (file:// assets, Capacitor, Cordova, or any
 * WebView that loads the bundle locally) the page has no server to rewrite deep
 * links, so use hash routing. Served on the web, keep clean paths.
 */
const nativeShell =
  typeof window !== 'undefined' &&
  /^(file|capacitor|ionic|app):$/.test(window.location.protocol);
const Router = nativeShell ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <Router>
        <App />
      </Router>
    </AuthProvider>
  </React.StrictMode>,
);
