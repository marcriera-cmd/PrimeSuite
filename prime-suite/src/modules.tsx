import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { api, type AuthMethod, type ModuleRole, type OpenMode } from './api';

// Resultado de /api/sso/launch para un módulo.
export interface Launch {
  moduleId: string;
  name: string;
  url: string;
  openMode: OpenMode;
  authMethod: AuthMethod;
  role: ModuleRole;
  expiresIn?: number;
  formPost?: { action: string; fields: Record<string, string> };
  /** Módulo sin SSO con inicio de sesión automático: de quién son las credenciales y si faltan. */
  autoLogin?: { mode: 'user' | 'shared'; missing: boolean; username?: string };
}

// Un módulo abierto: su iframe permanece montado aunque cambies de módulo,
// de modo que no se pierde lo que estabas haciendo dentro.
export interface OpenModule {
  id: string;
  name: string;
  initials?: string;
  color?: string;
  launch: Launch | null;
  loading: boolean;
  error: string | null;
  issuedAt: number;
}

export interface OpenMeta { name?: string; initials?: string; color?: string }

interface ModulesCtx {
  modules: OpenModule[];
  ensureOpen(id: string, meta?: OpenMeta): void;
  close(id: string): void;
  reload(id: string): void;
  onNative?: (url: string, id: string) => void;
  setOnNative(fn: (url: string, id: string) => void): void;
}

const Ctx = createContext<ModulesCtx | null>(null);

export function useModules() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useModules fuera de ModulesProvider');
  return c;
}

export function ModulesProvider({ children }: { children: ReactNode }) {
  const [modules, setModules] = useState<OpenModule[]>([]);
  const launching = useRef<Set<string>>(new Set());
  const nativeCb = useRef<((url: string, id: string) => void) | undefined>(undefined);

  const setOnNative = useCallback((fn: (url: string, id: string) => void) => {
    nativeCb.current = fn;
  }, []);

  const doLaunch = useCallback(async (id: string) => {
    if (launching.current.has(id)) return;
    launching.current.add(id);
    try {
      const l = await api.post<Launch>('/api/sso/launch', { moduleId: id });
      // Los módulos nativos (p. ej. Prime Insights) no se embeben: se navega a su ruta interna.
      if (l.openMode === 'native') {
        setModules((ms) => ms.filter((m) => m.id !== id));
        nativeCb.current?.(l.url, id);
        return;
      }
      setModules((ms) => ms.map((m) => (m.id === id ? { ...m, launch: l, name: l.name || m.name, loading: false, error: null, issuedAt: Date.now() } : m)));
    } catch (e: any) {
      setModules((ms) => ms.map((m) => (m.id === id ? { ...m, loading: false, error: e?.message || 'No se pudo abrir el módulo' } : m)));
    } finally {
      launching.current.delete(id);
    }
  }, []);

  const ensureOpen = useCallback((id: string, meta?: OpenMeta) => {
    setModules((ms) => {
      if (ms.some((m) => m.id === id)) return ms; // ya abierto: se conserva su estado
      return [...ms, { id, name: meta?.name || 'Aplicación', initials: meta?.initials, color: meta?.color, launch: null, loading: true, error: null, issuedAt: Date.now() }];
    });
    // Lanzar fuera del setState (si ya estaba, doLaunch no duplica por el guard).
    setTimeout(() => {
      setModules((cur) => {
        const m = cur.find((x) => x.id === id);
        if (m && !m.launch && !m.error) doLaunch(id);
        return cur;
      });
    }, 0);
  }, [doLaunch]);

  const close = useCallback((id: string) => {
    setModules((ms) => ms.filter((m) => m.id !== id));
  }, []);

  const reload = useCallback((id: string) => {
    setModules((ms) => ms.map((m) => (m.id === id ? { ...m, launch: null, loading: true, error: null } : m)));
    doLaunch(id);
  }, [doLaunch]);

  return (
    <Ctx.Provider value={{ modules, ensureOpen, close, reload, setOnNative }}>{children}</Ctx.Provider>
  );
}
