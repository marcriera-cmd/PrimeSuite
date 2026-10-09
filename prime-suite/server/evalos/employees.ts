// Atajos de Evalos · Empleados: piezas compartidas entre la pantalla Personal y el alta de usuarios del portal
// (un usuario puede darse de alta a la vez como empleado en la tabla PERSONAL de Evalos 8 de su empresa).
import { HttpError } from '../http.ts';
import { driverFor, getConfig, isConfigured } from './config.ts';
import { madridNow } from './history.ts';
import { sanitizeNewNames, sanitizePersonal } from './personal.ts';
import { syncPeriods } from './convperiods.ts';
import type { EvalosDriver } from './types.ts';

export type PersonalDriver = Required<EvalosDriver>;

/** Driver de la empresa con todas las operaciones de Personal. 409 si no hay conexión; 501 si el motor no las admite. */
export async function personalDriverFor(companyId: string) {
  const { driver, config } = await driverFor(companyId);
  if (!driver.listPersonal || !driver.getPersonal || !driver.createPersonal || !driver.updatePersonal || !driver.deletePersonal || !driver.personalLookups || !driver.personalLimits
    || !driver.personalHistory || !driver.assignHistory || !driver.closeHistory || !driver.userInitials || !driver.personalPeriods || !driver.readmitPersonal
    || !driver.updatePersonalContact) {
    throw new HttpError(501, 'Este motor de base de datos no admite todavía la pantalla Personal.');
  }
  return { driver: driver as PersonalDriver, config };
}

/** Fecha y hora (Madrid) e iniciales en Evalos del usuario que hace el cambio, para los históricos HIS_*. */
export async function stampFor(driver: PersonalDriver, email: string) {
  return { ...madridNow(), user: await driver.userInitials(email) };
}

/** Lo que necesita el formulario de alta de usuario para la parte de empleado de una empresa. */
export async function employeeFormInfo(companyId: string) {
  const cfg = await getConfig(companyId);
  if (!isConfigured(cfg)) return { configured: false as const };
  const { driver, config } = await personalDriverFor(companyId);
  const [lookups, limits] = await Promise.all([driver.personalLookups(), driver.personalLimits()]);
  return { configured: true as const, engine: config.engine, uppercase: config.uppercase, lookups, limits };
}

/**
 * Da de alta el empleado de un usuario nuevo del portal. El nombre y el email vienen del usuario (no se repiten
 * en el formulario); el resto de campos, de la sección de empleado. Devuelve el código del empleado.
 */
export async function createLinkedEmployee(companyId: string, actorEmail: string, raw: any, name: string, email: string): Promise<string> {
  const { driver, config } = await personalDriverFor(companyId);
  const [lookups, limits] = await Promise.all([driver.personalLookups(), driver.personalLimits()]);
  const opts = { uppercase: config.uppercase, limits, lookups };
  const emp = sanitizePersonal({ ...(raw || {}), name, email }, opts);
  const newNames = sanitizeNewNames(raw?.newNames, emp, opts);
  const stamp = await stampFor(driver, actorEmail);
  await driver.createPersonal(emp, stamp, newNames);
  // Con convenio: sus periodos de vacaciones y límites (si falla, el alta ya está hecha y no se deshace).
  if (emp.convenio && driver.getConvenio) {
    try {
      const conv = await driver.getConvenio(emp.convenio);
      const p = await driver.getPersonal(emp.code);
      if (conv && p) { const d = stamp.date; await syncPeriods(driver, conv, [p], 'current', `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, stamp); }
    } catch { /* los periodos se pueden regenerar guardando el convenio */ }
  }
  return emp.code;
}

/** Copia el nombre y el email del usuario a su ficha de empleado vinculada. */
export async function syncLinkedEmployee(companyId: string, code: string, name: string, email: string) {
  const { driver, config } = await personalDriverFor(companyId);
  let n = name.replace(/\s+/g, ' ').trim();
  if (config.uppercase) n = n.toLocaleUpperCase('es-ES');
  const max = (await driver.personalLimits()).name;
  if (max && n.length > max) throw new HttpError(400, `El nombre admite como máximo ${max} caracteres en Evalos`);
  // EM_WFEM siempre en mayúsculas (el email del usuario del portal no cambia).
  await driver.updatePersonalContact(code, n, email.toUpperCase());
}
