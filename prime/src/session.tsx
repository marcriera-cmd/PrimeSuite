import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Me } from './api';

interface SessionState {
  me: Me | null;
  loading: boolean;
  needsSetup: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionState>(null as unknown as SessionState);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/api/me'));
      setNeedsSetup(false);
    } catch {
      setMe(null);
      try {
        const s = await api.get<{ needsSetup: boolean }>('/api/setup/status');
        setNeedsSetup(s.needsSetup);
      } catch {}
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUnauth = () => setMe(null);
    window.addEventListener('ps:unauthorized', onUnauth);
    return () => window.removeEventListener('ps:unauthorized', onUnauth);
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => {});
    setMe(null);
  }, []);

  return <Ctx.Provider value={{ me, loading, needsSetup, refresh, logout }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
