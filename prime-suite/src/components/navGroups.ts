// Grupos plegables de los menús: recuerda en el navegador qué grupos dejó abiertos cada persona.
import { useEffect, useState } from 'react';

const KEY = 'ps.nav.groups';
function readAll(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function writeOne(id: string, open: boolean) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [id]: open })); } catch { /* sin almacenamiento: no se recuerda */ }
}

/**
 * Estado abierto/cerrado de un grupo de menú.
 * - Si la pantalla actual está dentro del grupo (`containsActive`), se abre.
 * - Si no, se usa lo que eligió la persona la última vez o, si nunca lo tocó, `defaultOpen`.
 */
export function useNavGroup(id: string, containsActive: boolean, defaultOpen = false) {
  const [open, setOpen] = useState<boolean>(() => containsActive || (readAll()[id] ?? defaultOpen));
  useEffect(() => { if (containsActive) setOpen(true); }, [containsActive]);
  const toggle = () => setOpen((v) => { writeOne(id, !v); return !v; });
  return [open, toggle] as const;
}
