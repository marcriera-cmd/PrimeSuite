// Driver de demostración: datos ficticios guardados en el almacén del portal, para probar la interfaz
// sin una base de datos de Evalos 8. Se activa eligiendo "Demostración" en Configuración.
import { HttpError } from '../http.ts';
import { rawGet, rawSet, id as newId } from '../db.ts';
import {
  DEFAULT_MAPPING, type Ausencia, type Calendar, type CalendarDetail, type Convenio, type Department,
  type DepartmentEmployee, type DetectResult, type EmployeeBrief, type EvalosDriver, type Holiday,
  type CardAssignment, type ChangeStamp, type Marcaje, type MarcajePunch, type Personal, type PersonalInput, type PersonalLimits, type PersonalLookups,
  type Solicitud, type VacationCalc
} from './types.ts';
import { cardDescription, dmy, madridNow, toAssignment, ymdOf } from './cards.ts';

interface DemoCalendar { code: string; name: string; year: number; convenio?: string; employees: number; days: Holiday[] }
/** Empleado de demo. Fechas: endDate en aaaammdd (como Evalos), hireDate en AAAA-MM-DD. */
interface DemoEmployee {
  code: string; name: string; department: string; endDate: string; hireDate?: string;
  card?: string; email?: string; company?: string; section?: string; area?: string; consultas?: string; solicitudes?: string;
}
/** Fila de HIS_TARJETA en demo (fechas aaaammdd, baja '0' = sin baja). */
interface DemoCardRow { emp: string; card: string; falt: string; fbaj: string; tipo: string; fech: string; hora: string; usua: string }
interface DemoData {
  /** Tabla TARJETA y asignaciones HIS_TARJETA. */
  tarjetas?: { code: string; description: string }[];
  cardHistory?: DemoCardRow[];
  departments: { code: string; description: string }[];
  employees: DemoEmployee[];
  calendars: DemoCalendar[];
  convenios: Convenio[];
  marcajes: Marcaje[];
  solicitudes: Solicitud[];
  ausencias: Ausencia[];
}

const FIRST = ['ANA', 'LUIS', 'MARTA', 'JORGE', 'LAURA', 'PABLO', 'ELENA', 'DAVID', 'SARA', 'RAÚL', 'NURIA', 'IVÁN', 'CLARA', 'ÓSCAR'];
const LAST = ['GARCÍA', 'MARTÍNEZ', 'LÓPEZ', 'SÁNCHEZ', 'PÉREZ', 'GÓMEZ', 'RUIZ', 'DÍAZ', 'MORENO', 'MUÑOZ', 'ÁLVAREZ', 'ROMERO', 'NAVARRO', 'TORRES'];

// Festivos de ejemplo (Cataluña / Barcelona) para el año en curso del calendario demo.
function holidays2026(): Holiday[] {
  return [
    { date: '2026-01-01', type: 'NACIONAL', description: 'Año Nuevo' },
    { date: '2026-01-06', type: 'NACIONAL', description: 'Reyes' },
    { date: '2026-04-03', type: 'NACIONAL', description: 'Viernes Santo' },
    { date: '2026-04-06', type: 'AUTONOMICO', description: 'Lunes de Pascua' },
    { date: '2026-05-01', type: 'NACIONAL', description: 'Fiesta del Trabajo' },
    { date: '2026-06-24', type: 'AUTONOMICO', description: 'Sant Joan' },
    { date: '2026-08-15', type: 'NACIONAL', description: 'Asunción' },
    { date: '2026-09-11', type: 'AUTONOMICO', description: 'Diada de Catalunya' },
    { date: '2026-09-24', type: 'LOCAL', description: 'La Mercè (Barcelona)' },
    { date: '2026-10-12', type: 'NACIONAL', description: 'Fiesta Nacional' },
    { date: '2026-11-01', type: 'NACIONAL', description: 'Todos los Santos' },
    { date: '2026-12-06', type: 'NACIONAL', description: 'Constitución' },
    { date: '2026-12-08', type: 'NACIONAL', description: 'Inmaculada' },
    { date: '2026-12-25', type: 'NACIONAL', description: 'Navidad' },
    { date: '2026-12-26', type: 'AUTONOMICO', description: 'Sant Esteve' }
  ];
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function recentWeekdays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  while (out.length < n) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) out.push(iso(d));
    d.setDate(d.getDate() - 1);
  }
  return out;
}

function seed(): DemoData {
  const departments = [
    { code: 'ADMIN', description: 'ADMINISTRACIÓN' },
    { code: 'COMERCIAL', description: 'COMERCIAL' },
    { code: 'INFORMATICA', description: 'INFORMÁTICA' },
    { code: 'LOGISTICA', description: 'LOGÍSTICA Y ALMACÉN' },
    { code: 'PRODUCCION', description: 'PRODUCCIÓN' },
    { code: 'RRHH', description: 'RECURSOS HUMANOS' },
    { code: 'SAT', description: 'SERVICIO TÉCNICO' }
  ];
  const sizes = [5, 8, 6, 9, 14, 4, 0];
  const employees: DemoData['employees'] = [];
  let n = 1;
  departments.forEach((d, di) => {
    for (let i = 0; i < sizes[di]; i++, n++) {
      const name = `${LAST[(n * 3) % LAST.length]} ${LAST[(n * 5 + 1) % LAST.length]}, ${FIRST[(n * 7) % FIRST.length]}`;
      const hy = 2003 + ((n * 7) % 22); // antigüedad variada 2003-2024
      const hireDate = `${hy}-${String(1 + ((n * 3) % 12)).padStart(2, '0')}-${String(1 + ((n * 5) % 27)).padStart(2, '0')}`;
      employees.push({
        code: String(10000000 + n), name, department: d.code, endDate: n % 6 === 0 ? '20250630' : '', hireDate,
        card: String(4000 + n), company: 'PRIMION', section: ['OFI', 'TALLER', 'CAMPO'][n % 3], area: ['NORTE', 'CENTRO', 'ESTE'][n % 3], consultas: '001', solicitudes: '001'
      });
    }
  });

  const convenios: Convenio[] = [
    { code: 'OFI', name: 'Convenio Oficinas', vacationDays: 23, hoursYear: 1762, seniority: [{ years: 10, extraDays: 1 }, { years: 15, extraDays: 2 }, { years: 20, extraDays: 3 }] },
    { code: 'PROD', name: 'Convenio Producción', vacationDays: 22, hoursYear: 1780, seniority: [{ years: 15, extraDays: 1 }, { years: 25, extraDays: 2 }] },
    { code: 'COM', name: 'Convenio Comercial', vacationDays: 24, hoursYear: 1750, seniority: [{ years: 10, extraDays: 1 }, { years: 20, extraDays: 2 }] }
  ];
  const calendars: DemoCalendar[] = [
    { code: 'OFI2026', name: 'Oficinas 2026', year: 2026, convenio: 'OFI', employees: 15, days: holidays2026() },
    { code: 'FAB2026', name: 'Fábrica · turnos 2026', year: 2026, convenio: 'PROD', employees: 23, days: holidays2026() },
    { code: 'COM2026', name: 'Comercial 2026', year: 2026, convenio: 'COM', employees: 8, days: holidays2026() }
  ];

  // Marcajes de los últimos días laborables, con alguna incidencia.
  const days = recentWeekdays(6);
  const pick = employees.slice(0, 10);
  const marcajes: Marcaje[] = [];
  pick.forEach((e, i) => {
    const day = days[i % days.length];
    const anomaly = i % 4;
    if (anomaly === 1) marcajes.push({ id: `${e.code}-${day}`, employee: e.code, employeeName: e.name, date: day, punches: [{ time: '08:03', type: 'E' }], status: 'INCIDENCIA', issue: 'Falta el marcaje de salida' });
    else if (anomaly === 2) marcajes.push({ id: `${e.code}-${day}`, employee: e.code, employeeName: e.name, date: day, punches: [{ time: '09:47', type: 'E' }, { time: '18:10', type: 'S' }], status: 'INCIDENCIA', issue: 'Entrada fuera de horario (retraso)' });
    else marcajes.push({ id: `${e.code}-${day}`, employee: e.code, employeeName: e.name, date: day, punches: [{ time: '08:00', type: 'E' }, { time: '13:30', type: 'S' }, { time: '14:30', type: 'E' }, { time: '17:30', type: 'S' }], status: 'OK' });
  });

  const d0 = days[0];
  const solicitudes: Solicitud[] = [
    { id: 's1', employee: pick[0].code, employeeName: pick[0].name, type: 'Vacaciones', from: '2026-08-03', to: '2026-08-14', days: 10, reason: 'Vacaciones de verano', status: 'PENDIENTE', createdAt: d0 },
    { id: 's2', employee: pick[2].code, employeeName: pick[2].name, type: 'Permiso retribuido', from: '2026-10-09', to: '2026-10-09', days: 1, reason: 'Asunto médico', status: 'PENDIENTE', createdAt: d0 },
    { id: 's3', employee: pick[4].code, employeeName: pick[4].name, type: 'Cambio de turno', from: '2026-10-15', to: '2026-10-15', days: 1, reason: 'Turno de tarde por mañana', status: 'PENDIENTE', createdAt: d0 },
    { id: 's4', employee: pick[6].code, employeeName: pick[6].name, type: 'Asuntos propios', from: '2026-11-02', to: '2026-11-02', days: 1, status: 'APROBADA', createdAt: d0 }
  ];
  const ausencias: Ausencia[] = [
    { id: 'a1', employee: pick[1].code, employeeName: pick[1].name, type: 'Enfermedad común', from: '2026-09-28', to: '2026-10-02', days: 5, reason: 'Baja IT' },
    { id: 'a2', employee: pick[3].code, employeeName: pick[3].name, type: 'Permiso retribuido', from: '2026-10-01', to: '2026-10-01', days: 1, reason: 'Mudanza' },
    { id: 'a3', employee: pick[5].code, employeeName: pick[5].name, type: 'Vacaciones', from: '2026-08-01', to: '2026-08-15', days: 11 }
  ];

  return { departments, employees, calendars, convenios, marcajes, solicitudes, ausencias };
}

/** Catálogos de los desplegables de Personal en modo demostración. */
const DEMO_LOOKUPS: Omit<PersonalLookups, 'department'> = {
  company: [{ code: 'PRIMION', description: 'PRIMION DIGITEK S.L.' }, { code: 'FILIAL', description: 'PRIMION SERVICIOS' }],
  section: [{ code: 'OFI', description: 'OFICINAS' }, { code: 'TALLER', description: 'TALLER' }, { code: 'CAMPO', description: 'PERSONAL DE CAMPO' }],
  area: [{ code: 'NORTE', description: 'ZONA NORTE' }, { code: 'CENTRO', description: 'ZONA CENTRO' }, { code: 'ESTE', description: 'ZONA ESTE' }],
  consultas: [{ code: '001', description: 'CONSULTA BÁSICA' }, { code: '002', description: 'CONSULTA COMPLETA' }],
  solicitudes: [{ code: '001', description: 'SOLICITUDES ESTÁNDAR' }, { code: '002', description: 'SOLICITUDES RESPONSABLES' }]
};
const ymdToIso = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '');

const ymd = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};
const isActive = (end: string) => !end || end === '0' || end >= ymd();
const daysBetween = (from: string, to: string) => Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);

export class DemoDriver implements EvalosDriver {
  constructor(private companyId: string) {}
  private key() { return `evalos-demo/${this.companyId}`; }
  private async load(): Promise<DemoData> {
    let d = await rawGet<DemoData>(this.key());
    if (!d) { d = seed(); await rawSet(this.key(), d); }
    // Compatibilidad con almacenes de demo anteriores (solo departamentos/empleados).
    if (!d.calendars || !d.convenios || !d.marcajes) { const s = seed(); d = { ...s, departments: d.departments, employees: d.employees.map((e) => ({ ...e, hireDate: e.hireDate })) }; await rawSet(this.key(), d); }
    // Tarjetas: las fichas de demo anteriores solo tenían EM_TARJ; se crean su tarjeta y su asignación.
    if (!d.cardHistory) {
      d.tarjetas = [];
      d.cardHistory = [];
      for (const e of d.employees) {
        if (!e.card) continue;
        d.tarjetas.push({ code: e.card, description: cardDescription(e.card) });
        d.cardHistory.push({ emp: e.code, card: e.card, falt: ymdOf(e.hireDate || '2020-01-01'), fbaj: '0', tipo: 'A', fech: '', hora: '', usua: 'DEM' });
      }
      await rawSet(this.key(), d);
    }
    return d;
  }
  private save(d: DemoData) { return rawSet(this.key(), d); }

  async info() { return { engine: 'demo' as const, server: 'Datos de demostración', database: 'EVALOS_DEMO', version: 'Prime Suite' }; }
  async detect(): Promise<DetectResult> {
    return { mapping: { ...DEFAULT_MAPPING, departments: { table: 'DEPMENTO', code: 'DE_CODI', description: 'DE_DESC' } }, candidates: [], warnings: ['Modo demostración: no hay base de datos real que analizar.'] };
  }
  async departmentLimits() { return { code: 12, description: 40 }; }

  private count(d: DemoData, code: string): Department {
    const dep = d.departments.find((x) => x.code === code)!;
    const emps = d.employees.filter((e) => e.department === code);
    return { ...dep, employees: emps.length, active: emps.filter((e) => isActive(e.endDate)).length };
  }
  async listDepartments() {
    const d = await this.load();
    return d.departments.map((x) => this.count(d, x.code)).sort((a, b) => a.code.localeCompare(b.code));
  }
  async getDepartment(code: string) {
    const d = await this.load();
    return d.departments.some((x) => x.code === code) ? this.count(d, code) : null;
  }
  async createDepartment(code: string, description: string) {
    const d = await this.load();
    if (d.departments.some((x) => x.code === code)) throw new HttpError(409, `Ya existe el departamento ${code}`);
    d.departments.push({ code, description });
    await this.save(d);
  }
  async updateDepartment(code: string, description: string) {
    const d = await this.load();
    const x = d.departments.find((y) => y.code === code);
    if (!x) throw new HttpError(404, `No existe el departamento ${code}`);
    x.description = description;
    await this.save(d);
  }
  async deleteDepartment(code: string) {
    const d = await this.load();
    const n = d.employees.filter((e) => e.department === code).length;
    if (n) throw new HttpError(409, `No se puede eliminar: ${n} empleado(s) tienen asignado el departamento ${code}.`);
    if (!d.departments.some((x) => x.code === code)) throw new HttpError(404, `No existe el departamento ${code}`);
    d.departments = d.departments.filter((x) => x.code !== code);
    await this.save(d);
  }
  async departmentEmployees(code: string): Promise<DepartmentEmployee[]> {
    const d = await this.load();
    return d.employees
      .filter((e) => e.department === code)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({ code: e.code, name: e.name, active: isActive(e.endDate), endDate: e.endDate ? `${e.endDate.slice(6)}/${e.endDate.slice(4, 6)}/${e.endDate.slice(0, 4)}` : undefined }));
  }

  async listEmployees(): Promise<EmployeeBrief[]> {
    const d = await this.load();
    return d.employees.filter((e) => isActive(e.endDate)).map((e) => ({ code: e.code, name: e.name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------- Personal ----------
  private toPersonal(e: DemoEmployee): Personal {
    return {
      code: e.code, name: e.name, card: e.card || '', email: e.email || '', hireDate: e.hireDate || '', endDate: ymdToIso(e.endDate),
      company: e.company || '', department: e.department || '', section: e.section || '', area: e.area || '',
      consultas: e.consultas || '', solicitudes: e.solicitudes || '', active: isActive(e.endDate)
    };
  }
  private fromInput(p: PersonalInput): DemoEmployee {
    return {
      code: p.code, name: p.name, card: p.card, email: p.email, hireDate: p.hireDate, endDate: p.endDate.replace(/-/g, ''),
      company: p.company, department: p.department, section: p.section, area: p.area, consultas: p.consultas, solicitudes: p.solicitudes
    };
  }
  private hist(d: DemoData) { return (d.cardHistory ||= []); }
  private isOpenAt(r: DemoCardRow, ymd: string) { return !r.fbaj || r.fbaj === '0' || r.fbaj >= ymd; }
  private checkCardFree(d: DemoData, card: string, code: string, fromIso: string) {
    const r = this.hist(d).filter((x) => x.card === card && x.emp !== code && this.isOpenAt(x, ymdOf(fromIso))).sort((a, b) => b.falt.localeCompare(a.falt))[0];
    if (r) {
      const until = r.fbaj && r.fbaj !== '0' ? `${r.fbaj.slice(0, 4)}-${r.fbaj.slice(4, 6)}-${r.fbaj.slice(6, 8)}` : '';
      throw new HttpError(409, `La tarjeta ${card} la tiene asignada el empleado ${r.emp}${until ? ` hasta el ${dmy(until)}` : ' sin fecha de baja'}.`);
    }
  }
  private addAssignment(d: DemoData, code: string, card: string, fromIso: string, stamp: ChangeStamp) {
    d.tarjetas ||= [];
    if (!d.tarjetas.some((t) => t.code === card)) d.tarjetas.push({ code: card, description: cardDescription(card) });
    this.hist(d).push({ emp: code, card, falt: ymdOf(fromIso), fbaj: '0', tipo: 'A', fech: stamp.date, hora: stamp.time, usua: stamp.user });
  }
  /** EM_TARJ = tarjeta vigente más reciente (antes las que no tienen baja). */
  private syncCard(d: DemoData, code: string, today: string) {
    const e = d.employees.find((x) => x.code === code);
    if (!e) return;
    const open = this.hist(d).filter((r) => r.emp === code && this.isOpenAt(r, today))
      .sort((a, b) => Number(!a.fbaj || a.fbaj === '0' ? 0 : 1) - Number(!b.fbaj || b.fbaj === '0' ? 0 : 1) || b.falt.localeCompare(a.falt));
    e.card = open[0]?.card || '';
  }
  async listPersonal(): Promise<Personal[]> {
    const d = await this.load();
    return d.employees.map((e) => this.toPersonal(e)).sort((a, b) => a.code.localeCompare(b.code));
  }
  async getPersonal(code: string) {
    const e = (await this.load()).employees.find((x) => x.code === code);
    return e ? this.toPersonal(e) : null;
  }
  async createPersonal(p: PersonalInput, stamp: ChangeStamp) {
    const d = await this.load();
    if (d.employees.some((e) => e.code === p.code)) throw new HttpError(409, `Ya existe el empleado ${p.code}`);
    if (p.card) this.checkCardFree(d, p.card, p.code, p.hireDate);
    d.employees.push(this.fromInput(p));
    if (p.card) this.addAssignment(d, p.code, p.card, p.hireDate, stamp);
    await this.save(d);
  }
  async updatePersonal(code: string, p: Omit<PersonalInput, 'code'>) {
    const d = await this.load();
    const i = d.employees.findIndex((e) => e.code === code);
    if (i < 0) throw new HttpError(404, `No existe el empleado ${code}`);
    // La tarjeta solo cambia al asignar/desasignar.
    d.employees[i] = { ...this.fromInput({ ...p, code }), card: d.employees[i].card };
    await this.save(d);
  }
  async deletePersonal(code: string) {
    const d = await this.load();
    if (!d.employees.some((e) => e.code === code)) throw new HttpError(404, `No existe el empleado ${code}`);
    const used = [
      d.marcajes.some((m) => m.employee === code) && 'marcajes',
      d.ausencias.some((a) => a.employee === code) && 'ausencias',
      d.solicitudes.some((s) => s.employee === code) && 'solicitudes'
    ].filter(Boolean);
    if (used.length) throw new HttpError(409, `No se puede eliminar el empleado ${code} porque tiene datos en Evalos: ${used.join(', ')}. Dale de baja con la fecha de baja.`);
    d.employees = d.employees.filter((e) => e.code !== code);
    d.cardHistory = this.hist(d).filter((r) => r.emp !== code);
    await this.save(d);
  }
  async personalCards(code: string): Promise<CardAssignment[]> {
    const d = await this.load();
    const today = madridNow().date;
    return this.hist(d).filter((r) => r.emp === code)
      .sort((a, b) => b.falt.localeCompare(a.falt) || a.card.localeCompare(b.card))
      .map((r) => toAssignment(r, today));
  }
  async assignCard(code: string, card: string, from: string, stamp: ChangeStamp) {
    const d = await this.load();
    if (!d.employees.some((e) => e.code === code)) throw new HttpError(404, `No existe el empleado ${code}`);
    this.checkCardFree(d, card, code, from);
    const mine = this.hist(d).find((r) => r.emp === code && r.card === card && this.isOpenAt(r, ymdOf(from)));
    if (mine) throw new HttpError(409, `El empleado ${code} ya tiene asignada la tarjeta ${card} desde el ${dmy(`${mine.falt.slice(0, 4)}-${mine.falt.slice(4, 6)}-${mine.falt.slice(6, 8)}`)}.`);
    if (this.hist(d).some((r) => r.emp === code && r.card === card && r.falt === ymdOf(from))) throw new HttpError(409, `Ya hay un tramo de la tarjeta ${card} que empieza el ${dmy(from)} para este empleado.`);
    this.addAssignment(d, code, card, from, stamp);
    this.syncCard(d, code, stamp.date);
    await this.save(d);
  }
  async unassignCard(code: string, card: string, from: string, to: string, stamp: ChangeStamp) {
    if (to < from) throw new HttpError(400, 'La fecha de baja no puede ser anterior a la de alta de la asignación');
    const d = await this.load();
    const r = this.hist(d).find((x) => x.emp === code && x.card === card && x.falt === ymdOf(from) && this.isOpenAt(x, stamp.date));
    if (!r) throw new HttpError(404, `El empleado ${code} no tiene vigente la tarjeta ${card} desde el ${dmy(from)}.`);
    Object.assign(r, { fbaj: ymdOf(to), tipo: 'B', fech: stamp.date, hora: stamp.time, usua: stamp.user });
    this.syncCard(d, code, stamp.date);
    await this.save(d);
  }
  async userInitials(email: string) {
    return (email.split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '') + 'XXX').slice(0, 3);
  }
  async personalLookups(): Promise<PersonalLookups> {
    const d = await this.load();
    return { ...DEMO_LOOKUPS, department: d.departments.map((x) => ({ code: x.code, description: x.description })) };
  }
  async personalLimits(): Promise<PersonalLimits> {
    return { code: 50, name: 100, card: 50, email: 100, company: 15, department: 15, section: 15, area: 15, consultas: 3, solicitudes: 3 };
  }

  // ---------- Calendarios ----------
  private calSummary(c: DemoCalendar): Calendar { return { code: c.code, name: c.name, year: c.year, convenio: c.convenio, employees: c.employees, holidays: c.days.length }; }
  async listCalendars(): Promise<Calendar[]> {
    const d = await this.load();
    return d.calendars.map((c) => this.calSummary(c)).sort((a, b) => a.name.localeCompare(b.name));
  }
  async getCalendar(code: string): Promise<CalendarDetail | null> {
    const d = await this.load();
    const c = d.calendars.find((x) => x.code === code);
    if (!c) return null;
    return { ...this.calSummary(c), days: [...c.days].sort((a, b) => a.date.localeCompare(b.date)) };
  }
  async createCalendar(c: { code: string; name: string; year: number; convenio?: string }) {
    const d = await this.load();
    if (d.calendars.some((x) => x.code === c.code)) throw new HttpError(409, `Ya existe el calendario ${c.code}`);
    d.calendars.push({ code: c.code, name: c.name, year: c.year, convenio: c.convenio || undefined, employees: 0, days: [] });
    await this.save(d);
  }
  async updateCalendar(code: string, patch: { name?: string; convenio?: string }) {
    const d = await this.load();
    const c = d.calendars.find((x) => x.code === code);
    if (!c) throw new HttpError(404, `No existe el calendario ${code}`);
    if (patch.name !== undefined) c.name = patch.name;
    if (patch.convenio !== undefined) c.convenio = patch.convenio || undefined;
    await this.save(d);
  }
  async deleteCalendar(code: string) {
    const d = await this.load();
    if (!d.calendars.some((x) => x.code === code)) throw new HttpError(404, `No existe el calendario ${code}`);
    d.calendars = d.calendars.filter((x) => x.code !== code);
    await this.save(d);
  }
  async addHoliday(code: string, h: Holiday) {
    const d = await this.load();
    const c = d.calendars.find((x) => x.code === code);
    if (!c) throw new HttpError(404, `No existe el calendario ${code}`);
    if (c.days.some((x) => x.date === h.date)) throw new HttpError(409, `El calendario ya tiene un festivo el ${h.date}`);
    c.days.push(h);
    await this.save(d);
  }
  async deleteHoliday(code: string, date: string) {
    const d = await this.load();
    const c = d.calendars.find((x) => x.code === code);
    if (!c) throw new HttpError(404, `No existe el calendario ${code}`);
    c.days = c.days.filter((x) => x.date !== date);
    await this.save(d);
  }

  // ---------- Convenios ----------
  async listConvenios(): Promise<Convenio[]> {
    const d = await this.load();
    return d.convenios.map((c) => ({ ...c, calendars: d.calendars.filter((x) => x.convenio === c.code).length })).sort((a, b) => a.name.localeCompare(b.name));
  }
  async getConvenio(code: string) {
    const d = await this.load();
    return d.convenios.find((x) => x.code === code) || null;
  }
  async saveConvenio(c: Convenio, isNew: boolean) {
    const d = await this.load();
    const idx = d.convenios.findIndex((x) => x.code === c.code);
    if (isNew && idx >= 0) throw new HttpError(409, `Ya existe el convenio ${c.code}`);
    if (!isNew && idx < 0) throw new HttpError(404, `No existe el convenio ${c.code}`);
    const clean: Convenio = { code: c.code, name: c.name, vacationDays: c.vacationDays, hoursYear: c.hoursYear, seniority: [...c.seniority].sort((a, b) => a.years - b.years) };
    if (idx >= 0) d.convenios[idx] = clean; else d.convenios.push(clean);
    await this.save(d);
  }
  async deleteConvenio(code: string) {
    const d = await this.load();
    const used = d.calendars.filter((x) => x.convenio === code).length;
    if (used) throw new HttpError(409, `No se puede eliminar: ${used} calendario(s) usan el convenio ${code}.`);
    if (!d.convenios.some((x) => x.code === code)) throw new HttpError(404, `No existe el convenio ${code}`);
    d.convenios = d.convenios.filter((x) => x.code !== code);
    await this.save(d);
  }
  async calcVacation(convenioCode: string, hireDate: string, year: number): Promise<VacationCalc> {
    const d = await this.load();
    const conv = d.convenios.find((x) => x.code === convenioCode);
    if (!conv) throw new HttpError(404, `No existe el convenio ${convenioCode}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) throw new HttpError(400, 'Fecha de alta no válida');
    const endOfYear = new Date(year, 11, 31);
    const hire = new Date(hireDate + 'T00:00:00');
    let seniorityYears = endOfYear.getFullYear() - hire.getFullYear();
    const anniv = new Date(year, hire.getMonth(), hire.getDate());
    if (anniv > endOfYear) seniorityYears -= 1;
    seniorityYears = Math.max(0, seniorityYears);
    const extra = conv.seniority.filter((t) => seniorityYears >= t.years).reduce((m, t) => Math.max(m, t.extraDays), 0);
    const totalDays = conv.vacationDays + extra;
    const yearStart = new Date(year, 0, 1);
    const yearDays = Math.round((new Date(year + 1, 0, 1).getTime() - yearStart.getTime()) / 86400000);
    const start = hire > yearStart ? hire : yearStart;
    const workedDays = hire.getFullYear() > year ? 0 : Math.round((endOfYear.getTime() - start.getTime()) / 86400000) + 1;
    const proratedDays = Math.round(totalDays * (Math.min(workedDays, yearDays) / yearDays) * 10) / 10;
    return { convenio: conv.code, convenioName: conv.name, year, hireDate, baseDays: conv.vacationDays, seniorityYears, seniorityExtra: extra, totalDays, proratedDays, workedDays: Math.min(workedDays, yearDays), yearDays };
  }

  // ---------- Correcciones ----------
  async listMarcajes(): Promise<Marcaje[]> {
    const d = await this.load();
    return [...d.marcajes].sort((a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName));
  }
  private recomputeMarcaje(m: Marcaje) {
    const punches = [...m.punches].sort((a, b) => a.time.localeCompare(b.time));
    m.punches = punches;
    if (punches.length === 0) { m.status = 'INCIDENCIA'; m.issue = 'Sin marcajes'; return; }
    if (punches.length % 2 !== 0) { m.status = 'INCIDENCIA'; m.issue = 'Número impar de marcajes (falta entrada o salida)'; return; }
    m.status = 'OK'; m.issue = undefined;
  }
  async updateMarcaje(id: string, punches: MarcajePunch[]) {
    const d = await this.load();
    const m = d.marcajes.find((x) => x.id === id);
    if (!m) throw new HttpError(404, 'No existe el marcaje');
    m.punches = punches;
    this.recomputeMarcaje(m);
    await this.save(d);
  }
  async resolveMarcaje(id: string) {
    const d = await this.load();
    const m = d.marcajes.find((x) => x.id === id);
    if (!m) throw new HttpError(404, 'No existe el marcaje');
    m.status = 'OK'; m.issue = undefined;
    await this.save(d);
  }
  async listSolicitudes(): Promise<Solicitud[]> {
    const d = await this.load();
    const rank = (s: Solicitud) => (s.status === 'PENDIENTE' ? 0 : 1);
    return [...d.solicitudes].sort((a, b) => rank(a) - rank(b) || b.from.localeCompare(a.from));
  }
  async decideSolicitud(id: string, approve: boolean) {
    const d = await this.load();
    const s = d.solicitudes.find((x) => x.id === id);
    if (!s) throw new HttpError(404, 'No existe la solicitud');
    s.status = approve ? 'APROBADA' : 'RECHAZADA';
    // Al aprobar una ausencia/vacaciones, se refleja en Ausencias.
    if (approve && /vacacion|permiso|asunto|enferm/i.test(s.type)) {
      d.ausencias.unshift({ id: newId(), employee: s.employee, employeeName: s.employeeName, type: s.type, from: s.from, to: s.to, days: s.days, reason: s.reason });
    }
    await this.save(d);
  }
  async listAusencias(): Promise<Ausencia[]> {
    const d = await this.load();
    return [...d.ausencias].sort((a, b) => b.from.localeCompare(a.from));
  }
  async createAusencia(a: Omit<Ausencia, 'id' | 'employeeName' | 'days'>) {
    const d = await this.load();
    const emp = d.employees.find((e) => e.code === a.employee);
    if (!emp) throw new HttpError(404, 'No existe el empleado');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.from) || !/^\d{4}-\d{2}-\d{2}$/.test(a.to)) throw new HttpError(400, 'Fechas no válidas');
    if (a.to < a.from) throw new HttpError(400, 'La fecha de fin no puede ser anterior a la de inicio');
    d.ausencias.unshift({ id: newId(), employee: a.employee, employeeName: emp.name, type: a.type, from: a.from, to: a.to, days: daysBetween(a.from, a.to), reason: a.reason });
    await this.save(d);
  }
  async deleteAusencia(id: string) {
    const d = await this.load();
    if (!d.ausencias.some((x) => x.id === id)) throw new HttpError(404, 'No existe la ausencia');
    d.ausencias = d.ausencias.filter((x) => x.id !== id);
    await this.save(d);
  }
}

export async function resetDemo(companyId: string) {
  await rawSet(`evalos-demo/${companyId}`, seed());
}
