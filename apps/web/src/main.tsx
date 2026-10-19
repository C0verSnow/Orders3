import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app';
import './styles.css';
import { MotionProvider } from './components/motion';
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 1000 },
    mutations: { retry: false },
  },
});
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <MotionProvider>
      <div className="min-h-dvh bg-[#f5f5f7] font-sans text-[#1d1d1f] antialiased [color-scheme:light] dark:bg-zinc-950 dark:text-zinc-100 dark:[color-scheme:dark]">
        <App />
      </div>
    </MotionProvider>
  </QueryClientProvider>,
);
