import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSession, onAuthStateChange } from '../lib/supabaseAuth';

export function useAuthSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    getSession()
      .then((initialSession) => {
        if (!cancelled) {
          setSession(initialSession);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    const unsubscribe = onAuthStateChange((nextSession) => {
      setSession(nextSession);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { session, currentUserId: session?.user.id ?? null, isAuthenticated: Boolean(session), isLoading };
}
