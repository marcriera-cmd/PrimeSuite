// Alta automática de los usuarios de Prime Suite como usuarios de acceso a Evalos 8 (tabla USUARIOS).
//
// - Solo los usuarios con rol de portal distinto de «Usuario» (administradores) tienen registro en USUARIOS.
// - Al crear un usuario activo (o activar/aprobar uno pendiente, o subirle el rol) se da de alta en la BD de Evalos 8
//   de su empresa; si se le cambia el rol a «Usuario», se le quita (deprovisionEvalosUser).
// - Si en ese momento la empresa no tiene conexión con Evalos 8 (o falla), queda pendiente y se da de alta
//   en cuanto se guarda la conexión en Atajos de Evalos › Configuración.
// Un fallo aquí nunca impide crear el usuario en el portal.
import { Users, Companies, audit, now, type User } from '../db.ts';
import { decryptSecret } from '../crypto.ts';
import { getConfig } from './config.ts';
import { ensureEvalosUser, removeEvalosUser } from './mssql.ts';

export interface EvalosSyncSummary {
  /** Usuarios dados de alta (o ya existentes y enlazados) en Evalos 8. */
  created: number;
  failed: { email: string; error: string }[];
}

/** Solo los usuarios con un rol de portal distinto de «Usuario» (administradores) tienen acceso a Evalos 8 (USUARIOS). */
export const wantsEvalosAccess = (u: Pick<User, 'role'>) => u.role !== 'user';
const needsSync = (u: User) => u.status === 'active' && wantsEvalosAccess(u) && !u.evalos;

/** Da de alta al usuario en Evalos 8 si su empresa tiene conexión SQL Server. Devuelve el usuario actualizado. */
export async function provisionEvalosUser(user: User, actor?: { id: string; email: string } | null): Promise<User> {
  if (!needsSync(user)) return user;
  const cfg = await getConfig(user.companyId);
  if (!cfg || cfg.engine !== 'mssql' || !cfg.connEnc) return user; // se hará al activar la conexión
  try {
    const conn = await decryptSecret(cfg.connEnc);
    const r = await ensureEvalosUser(conn, cfg.mapping.employees.schema, user.email);
    const fresh = (await Users.get(user.id)) || user;
    const updated: User = { ...fresh, evalos: { initials: r.initials, at: now() } };
    delete updated.evalosError;
    await Users.put(updated);
    await audit({
      actorId: actor?.id ?? null, actorEmail: actor?.email ?? null, companyId: user.companyId,
      action: r.created ? 'evalos.user_created' : 'evalos.user_linked', target: user.email,
      detail: [`iniciales ${r.initials}`, r.skipped.length ? `columnas omitidas: ${r.skipped.join(', ')}` : ''].filter(Boolean).join(' · ')
    });
    return updated;
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 500);
    const fresh = (await Users.get(user.id)) || user;
    const updated: User = { ...fresh, evalosError: msg };
    await Users.put(updated);
    await audit({ actorId: actor?.id ?? null, actorEmail: actor?.email ?? null, companyId: user.companyId, action: 'evalos.user_failed', target: user.email, detail: msg });
    return updated;
  }
}

/** Da de alta en Evalos 8 a todos los usuarios activos de la empresa que aún no lo estén. */
export async function syncCompanyEvalosUsers(companyId: string, actor?: { id: string; email: string } | null): Promise<EvalosSyncSummary> {
  const summary: EvalosSyncSummary = { created: 0, failed: [] };
  if (!(await Companies.get(companyId))) return summary;
  const users = (await Users.all()).filter((u) => u.companyId === companyId && needsSync(u));
  for (const u of users) {
    const r = await provisionEvalosUser(u, actor);
    if (r.evalos) summary.created++;
    else if (r.evalosError) {
      summary.failed.push({ email: u.email, error: r.evalosError });
      // Si falla la conexión en sí, no tiene sentido seguir con el resto (cada intento esperaría al timeout).
      if (/conectar|rechazó|descifrar|mssql/i.test(r.evalosError)) break;
    }
  }
  return summary;
}

/** Quita el registro de USUARIOS de Evalos 8 a un usuario que pasa a rol «Usuario». Un fallo no impide guardar el usuario. */
export async function deprovisionEvalosUser(user: User, actor?: { id: string; email: string } | null): Promise<User> {
  const cfg = await getConfig(user.companyId);
  const fresh = (await Users.get(user.id)) || user;
  try {
    let removed = false;
    if (cfg && cfg.engine === 'mssql' && cfg.connEnc) {
      const conn = await decryptSecret(cfg.connEnc);
      removed = await removeEvalosUser(conn, cfg.mapping.employees.schema, user.email);
    }
    const updated: User = { ...fresh };
    delete updated.evalos;
    delete updated.evalosError;
    await Users.put(updated);
    await audit({ actorId: actor?.id ?? null, actorEmail: actor?.email ?? null, companyId: user.companyId, action: 'evalos.user_removed', target: user.email, detail: removed ? 'quitado de USUARIOS al pasar a rol Usuario' : 'no estaba en USUARIOS' });
    return updated;
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 500);
    const updated: User = { ...fresh, evalosError: `No se pudo quitar de USUARIOS: ${msg}` };
    await Users.put(updated);
    await audit({ actorId: actor?.id ?? null, actorEmail: actor?.email ?? null, companyId: user.companyId, action: 'evalos.user_remove_failed', target: user.email, detail: msg });
    return updated;
  }
}

