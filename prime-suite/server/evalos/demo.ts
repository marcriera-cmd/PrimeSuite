// Driver de demostración: datos ficticios guardados en el almacén del portal, para probar la interfaz
// sin una base de datos de Evalos 8. Se activa eligiendo "Demostración" en Configuración.
import { HttpError } from '../http.ts';
import { rawGet, rawSet } from '../db.ts';
import { DEFAULT_MAPPING, type Department, type DepartmentEmployee, type DetectResult, type EvalosDriver } from './types.ts';

interface DemoData {
  departments: { code: string; description: string }[];
  employees: { code: string; name: string; department: string; endDate: string }[];
}

const FIRST = ['ANA', 'LUIS', 'MARTA', 'JORGE', 'LAURA', 'PABLO', 'ELENA', 'DAVID', 'SARA', 'RAÚL', 'NURIA', 'IVÁN', 'CLARA', 'ÓSCAR'];
const LAST = ['GARCÍA', 'MARTÍNEZ', 'LÓPEZ', 'SÁNCHEZ', 'PÉREZ', 'GÓMEZ', 'RUIZ', 'DÍAZ', 'MORENO', 'MUÑOZ', 'ÁLVAREZ', 'ROMERO', 'NAVARRO', 'TORRES'];

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
      employees.push({ code: String(10000000 + n), name, department: d.code, endDate: n % 6 === 0 ? '20250630' : '' });
    }
  });
  return { departments, employees };
}

const ymd = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};
const isActive = (end: string) => !end || end === '0' || end >= ymd();

export class DemoDriver implements EvalosDriver {
  constructor(private companyId: string) {}
  private key() { return `evalos-demo/${this.companyId}`; }
  private async load(): Promise<DemoData> {
    let d = await rawGet<DemoData>(this.key());
    if (!d) {
      d = seed();
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
}

export async function resetDemo(companyId: string) {
  await rawSet(`evalos-demo/${companyId}`, seed());
}
