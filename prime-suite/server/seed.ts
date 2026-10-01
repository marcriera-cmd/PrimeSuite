// Datos iniciales que se crean en el asistente de primera configuración.
import { Categories, Companies, Groups, Modules, id, now, type Category, type Module } from './db.ts';

const CATS: [string, string][] = [
  ['ANALYTICS', '#243A4D'],
  ['PEOPLE', '#0E7C66'],
  ['PERFORMANCE', '#6D28D9'],
  ['SECURITY', '#FF3E41'],
  ['OTROS', '#5C6B78']
];

function mod(p: Partial<Module> & Pick<Module, 'name' | 'clientId' | 'url'>): Module {
  return {
    id: id(),
    description: '',
    categoryId: null,
    initials: p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
    color: '#243A4D',
    openMode: 'iframe',
    authMethod: 'none',
    tokenDelivery: 'fragment',
    tokenParam: 'prime_token',
    tokenTtlSec: 60,
    redirectUris: [],
    postLogoutRedirectUris: [],
    defaultRole: 'user',
    widgets: [],
    enabled: true,
    order: 50,
    createdAt: now(),
    updatedAt: now(),
    ...p
  };
}

export async function seed(opts: { origin: string; companyName: string; companyCode: string }) {
  const cats: Record<string, Category> = {};
  for (const [i, [name, color]] of CATS.entries()) {
    const c: Category = { id: id(), name, color, order: i, enabled: true };
    await Categories.put(c);
    cats[name] = c;
  }

  const modules: Module[] = [
    mod({ name: 'Prime Insights', clientId: 'prime-insights', url: '/insights', openMode: 'native', categoryId: cats.ANALYTICS.id, initials: 'PI', color: '#243A4D', iconGlyph: 'bars', description: 'Dashboards de Superset', order: 10 }),
    mod({ name: 'Primion IA', clientId: 'primion-ia', url: 'https://analytical-gpt.devtest.primion.eu', categoryId: cats.ANALYTICS.id, initials: 'IA', color: '#243A4D', iconGlyph: 'spark', description: 'Asistente de inteligencia artificial', order: 11 }),
    mod({ name: 'MyPrimion', clientId: 'myprimion', url: 'https://qa-myprimion-app.primion.eu/login/credentials', categoryId: cats.PEOPLE.id, initials: 'MP', color: '#0E7C66', iconGlyph: 'people', description: 'Gestión de presencia', order: 20 }),
    mod({ name: 'MyEvalos', clientId: 'myevalos', url: 'https://evalos-c.digitekcloud.com:4007/DigitekQ/MyEvalos', categoryId: cats.PEOPLE.id, initials: 'ME', color: '#0E7C66', iconGlyph: 'clock', description: 'Portal del empleado · control horario', order: 21 }),
    mod({ name: 'Atajos de Evalos', clientId: 'atajos-evalos', url: '/evalos', openMode: 'native', categoryId: cats.PEOPLE.id, initials: 'AE', color: '#0E7C66', iconGlyph: 'clock', description: 'Funciones principales de Evalos 8, directas sobre su base de datos', order: 23 }),
    mod({ name: 'Prime HR', clientId: 'prime-hr', url: 'https://bindok.es/DIGITEK_WEB/ES/?S=No_SameSite', categoryId: cats.PEOPLE.id, initials: 'HR', color: '#2E9BD6', iconGlyph: 'doc', description: 'Comunicaciones y documentación', order: 22, openMode: 'iframe' }),
    mod({ name: 'Prime Access Management', clientId: 'prime-access', url: 'https://accred.digitekcloud.com:852/auth/login/pri2', categoryId: cats.SECURITY.id, initials: 'AM', color: '#FF3E41', iconGlyph: 'lock', description: 'Accesos, visitas y contratas', order: 30 }),
    mod({ name: 'Prime Capacity', clientId: 'prime-capacity', url: 'https://dashboard.sitesandstats.com', categoryId: cats.SECURITY.id, initials: 'PC', color: '#FF3E41', iconGlyph: 'pie', description: 'Gestión de aforos', order: 31, enabled: false }),
    mod({ name: 'Novedades Primion', clientId: 'novedades', url: 'https://splendorous-sable-bb85fe.netlify.app/', categoryId: cats.OTROS.id, initials: 'NP', color: '#5C6B78', iconGlyph: 'bell', description: 'Novedades y lanzamientos', order: 40 })
  ];
  for (const m of modules) await Modules.put(m);

  const company = {
    id: id(),
    name: opts.companyName,
    code: opts.companyCode,
    enabledModules: modules.map((m) => m.id),
    moduleUrls: {},
    createdAt: now()
  };
  await Companies.put(company);

  await Groups.put({ id: id(), companyId: company.id, name: 'Empleados', description: 'Acceso estándar', moduleRoles: {}, createdAt: now() });

  return company;
}
