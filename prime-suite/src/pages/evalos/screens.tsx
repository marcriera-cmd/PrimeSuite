// Registro de pantallas de Atajos de Evalos.
// Cada pantalla tiene una versión de página (dentro del módulo) y una de widget (panel de Inicio).
// Para añadir una: crear su componente, registrarlo aquí y añadirla a EVALOS_SCREENS en server/routes/evalos.ts.
import type { ComponentType } from 'react';
import Departamentos, { DepartamentosWidget } from './Departamentos';
import Personal, { PersonalWidget } from './Personal';
import Calendarios, { CalendariosWidget } from './Calendarios';
import Teletrabajo, { TeletrabajoWidget } from './Teletrabajo';
import Correcciones, { CorreccionesWidget } from './Correcciones';

export interface EvalosScreen {
  key: string;
  title: string;
  /** Grupo del menú, siguiendo el árbol de opciones de Evalos 8. */
  group: string;
  /** Ruta equivalente en Evalos 8, para orientar al usuario. */
  evalosPath: string;
  glyph: string;
  Page: ComponentType;
  Widget: ComponentType;
}

export const SCREENS: EvalosScreen[] = [
  {
    key: 'departamentos',
    title: 'Departamentos',
    group: 'Organización',
    evalosPath: 'Configuración › Organización › Departamentos',
    glyph: '<path d="M4 21V5l8-3v19M12 8h8v13M8 9h.01M8 13h.01M8 17h.01M16 12h.01M16 16h.01"/>',
    Page: Departamentos,
    Widget: DepartamentosWidget
  },
  {
    key: 'personal',
    title: 'Personal',
    group: 'Personal',
    evalosPath: 'Personal',
    glyph: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
    Page: Personal,
    Widget: PersonalWidget
  },
  {
    key: 'calendarios',
    title: 'Calendarios y convenios',
    group: 'Gestión',
    evalosPath: 'Configuración › Calendarios · Personal › Convenios',
    glyph: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>',
    Page: Calendarios,
    Widget: CalendariosWidget
  },
  {
    key: 'teletrabajo',
    title: 'Teletrabajo',
    group: 'Gestión',
    evalosPath: 'Gestión de teletrabajo y presencial (Prime Suite)',
    glyph: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 11l3 2 7-6"/>',
    Page: Teletrabajo,
    Widget: TeletrabajoWidget
  },
  {
    key: 'correcciones',
    title: 'Correcciones',
    group: 'Gestión',
    evalosPath: 'Correcciones · Personal › Ausencias',
    glyph: '<path d="M14 7a4 4 0 0 1-5 5l-6 6 2 2 6-6a4 4 0 0 0 5-5z"/>',
    Page: Correcciones,
    Widget: CorreccionesWidget
  }
];

export const screenByKey = (k?: string | null) => SCREENS.find((s) => s.key === k);

/** Widget de una pantalla para el panel de Inicio. */
export function EvalosWidget({ screen }: { screen?: string }) {
  const s = screenByKey(screen);
  if (!s) return <span className="small muted">Pantalla no disponible</span>;
  return <s.Widget />;
}
