import { useEffect, useRef, useState } from 'react';

type RefreshButton = 'all' | 'overview' | 'sources';
type Result = 'success' | 'error';
type Feedback = { owner: RefreshButton; status: 'pending' | Result } | null;

// Lives in Workspace so changing pages cannot restart a result's lifetime.
export function useRefreshFeedback() {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const current = useRef({ generation: 0, pending: false, mounted: false });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    current.current.mounted = true;
    return () => {
      current.current.mounted = false;
      current.current.generation++;
      clearTimeout(timer.current);
    };
  }, []);

  const run = async (owner: RefreshButton, operation: () => Promise<unknown>) => {
    const control = current.current;
    if (!control.mounted || control.pending) return;
    control.pending = true;
    const generation = ++control.generation;
    clearTimeout(timer.current);
    setFeedback({ owner, status: 'pending' });
    let status: Result = 'success';
    try {
      await operation();
    } catch {
      // The mutation retains the real error explanation in Workspace.
      status = 'error';
    }
    if (!control.mounted || generation !== control.generation) return;
    control.pending = false;
    setFeedback({ owner, status });
    timer.current = setTimeout(() => {
      if (control.mounted && generation === control.generation) setFeedback(null);
    }, status === 'success' ? 900 : 1800);
  };

  return {
    run,
    statusFor: (owner: RefreshButton) => feedback?.owner === owner ? feedback.status : 'idle' as const,
  };
}
