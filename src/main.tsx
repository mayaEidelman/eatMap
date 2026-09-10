import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryCache, QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import App from './AppShell';
import './styles.css';

// react-query swallows refetch failures triggered by invalidateQueries by default (it doesn't
// throw/reject), so a failing query can otherwise fail completely silently -- no console output,
// no UI change. Logging every query error here means a failure is always at least visible in the
// console, even where a screen doesn't render `query.error` itself.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      console.error(`Query failed [${JSON.stringify(query.queryKey)}]:`, error);
    },
  }),
});

const localStoragePersister = createSyncStoragePersister({ storage: window.localStorage, key: 'eatmap-query-cache' });

// Only travel-time results get written to localStorage -- not lists/profiles/expenses/etc, which
// should always come fresh from Supabase rather than risk showing stale data after a reload.
// Distance Matrix calls are billed, and the duration between two fixed points barely ever changes,
// so surviving a page reload (not just staying cached for the rest of the current tab session) is
// worth the persistence here specifically. Failed lookups (e.g. a misconfigured API key) are
// deliberately excluded so fixing the key and reloading retries immediately instead of replaying
// the cached failure.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: localStoragePersister,
        maxAge: 24 * 60 * 60 * 1000,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => query.queryKey[0] === 'travelTime' && query.state.status === 'success',
        },
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </React.StrictMode>,
);