// Configuración de Atajos de Evalos por empresa (cada empresa/tenant tiene su propia BD de Evalos 8).
import { rawGet, rawSet, now } from '../db.ts';
import { decryptSecret } from '../crypto.ts';
import { HttpError } from '../http.ts';
import { SqlServerDriver } from './mssql.ts';
import { DemoDriver } from './demo.ts';
import { DEFAULT_MAPPING, type EvalosConfig, type EvalosDriver } from './types.ts';

const key = (companyId: string) => `evalos-config/${companyId}`;

export async function getConfig(companyId: string): Promise<EvalosConfig | null> {
  const c = await rawGet<EvalosConfig>(key(companyId));
  if (!c) return null;
  return { ...c, mapping: { ...DEFAULT_MAPPING, ...c.mapping, departments: { ...DEFAULT_MAPPING.departments, ...c.mapping?.departments }, employees: { ...DEFAULT_MAPPING.employees, ...c.mapping?.employees } } };
}

export async function putConfig(c: EvalosConfig) {
  await rawSet(key(c.companyId), { ...c, updatedAt: now() });
}

export const isConfigured = (c: EvalosConfig | null) => !!c && (c.engine === 'demo' || !!c.connEnc);

/** Driver para la empresa del usuario. Lanza 409 si todavía no hay conexión configurada. */
export async function driverFor(companyId: string, cfg?: EvalosConfig | null): Promise<{ driver: EvalosDriver; config: EvalosConfig }> {
  const config = cfg === undefined ? await getConfig(companyId) : cfg;
  if (!config || !isConfigured(config)) throw new HttpError(409, 'Atajos de Evalos aún no tiene configurada la conexión a la base de datos de Evalos 8. Un administrador debe indicarla en Configuración.', 'not_configured');
  if (config.engine === 'demo') return { driver: new DemoDriver(companyId), config };
  const conn = await decryptSecret(config.connEnc!).catch(() => {
    throw new HttpError(500, 'No se pudo descifrar la cadena de conexión guardada. Vuelve a introducirla en Configuración.');
  });
  return { driver: new SqlServerDriver(conn, config.mapping), config };
}
