import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);