import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { del, get, set } from 'idb-keyval';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './lib/auth';
import { ApiError } from './lib/api';
import './styles.css';

// Reload once when a waiting service worker takes control (after deploy).
let swRefreshing = false;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshing) return;
    swRefreshing = true;
    window.location.reload();
  });
}

registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (registration) {
      // Check for updates periodically while the app is open (common on mobile PWAs).
      window.setInterval(() => void registration.update(), 60_000);
    }
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 1000 * 60 * 60 * 24 * 7, // una semana en cache offline
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status === 401) return false;
        return failureCount < 1;
      },
      networkMode: 'offlineFirst',
    },
  },
});

// Cache persistente en IndexedDB: al abrir offline se renderiza el último
// snapshot; con conexión, las queries refetchean en background.
const persister = createAsyncStoragePersister({
  storage: {
    getItem: (key: string) => get(key),
    setItem: (key: string, value: unknown) => set(key, value),
    removeItem: (key: string) => del(key),
  },
  key: 'biko:query-cache',
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 * 7, buster: '2' }}
      >
        <AuthProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
