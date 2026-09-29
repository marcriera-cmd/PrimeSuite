// Datos iniciales que se crean en el asistente de primera configuración.
import { Categories, Companies, Groups, Modules, id, now, type Category, type Module } from './db.ts';

const CATS: [string, string][] = [
  ['ANALYTICS', '#1F5FBF'],
  ['PEOPLE', '#0E7C66'],
  ['PERFORMANCE', '#6D28D9'],
  ['SECURITY', '#B23A1E'],
  ['OTROS', '#52525B']
];

function mod(p: Partial<Module> & Pick<Module, 'name' | 'clientId' | 'url'>): Module {
  return {
    id: id(),
    description: '',
    categoryId: null,
    initials: p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
    color: '#1F5FBF',
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

  // Rutas relativas: se resuelven contra el dominio del portal (sirve igual en local, previews y producción).
  const demo = '/demo-app/';
  const modules: Module[] = [
    mod({
      name: 'Demo · Prime Token', clientId: 'demo-token', url: demo, categoryId: cats.OTROS.id, initials: 'DT', color: '#52525B', order: 1,
      description: 'App de prueba: recibe un Prime Token y lo valida con el JWKS', authMethod: 'prime_token',
      manifestUrl: '/demo-app/prime-app.json',
      widgets: [
        { id: 'visits', title: 'Visitas hoy', type: 'kpi', endpoint: `/demo-api/widgets/kpi`, size: 's', refreshSec: 60 },
        { id: 'week', title: 'Accesos por día', type: 'chart', endpoint: `/demo-api/widgets/chart`, size: 'l', refreshSec: 300 },
        { id: 'pending', title: 'Pendientes de aprobar', type: 'list', endpoint: `/demo-api/widgets/list`, size: 'm', refreshSec: 120 }
      ]
    }),
    mod({
      name: 'Demo · OpenID Connect', clientId: 'demo-oidc', url: demo + '?mode=oidc', categoryId: cats.OTROS.id, initials: 'DO', color: '#52525B', order: 2,
      description: 'App de prueba: login estándar OIDC (code + PKCE) contra Prime ID', authMethod: 'oidc',
      redirectUris: [demo, demo + 'index.html'], postLogoutRedirectUris: [demo], initiateLoginUri: demo + '?mode=oidc'
    }),
    mod({ name: 'Prime Insights', clientId: 'prime-insights', url: 'https://insights.example.com', categoryId: cats.ANALYTICS.id, color: '#1F5FBF', description: 'Dashboards y analítica', order: 10, enabled: false }),
    mod({ name: 'Primion IA', clientId: 'primion-ia', url: 'https://analytical-gpt.devtest.primion.eu', categoryId: cats.ANALYTICS.id, initials: 'IA', color: '#1F5FBF', description: 'Asistente de inteligencia artificial', order: 11 }),
    mod({ name: 'MyPrimion', clientId: 'myprimion', url: 'https://qa-myprimion-app.primion.eu/login/credentials', categoryId: cats.PEOPLE.id, initials: 'MP', color: '#0E7C66', description: 'Gestión de presencia', order: 20 }),
    mod({ name: 'MyEvalos', clientId: 'myevalos', url: 'https://evalos-c.digitekcloud.com:4007/DigitekQ/MyEvalos', categoryId: cats.PEOPLE.id, initials: 'ME', color: '#0E7C66', description: 'Portal del empleado · control horario', order: 21 }),
    mod({ name: 'Prime HR', clientId: 'prime-hr', url: 'https://bindok.es/DIGITEK_WEB/ES/?S=No_SameSite', categoryId: cats.PEOPLE.id, initials: 'HR', color: '#0E7C66', description: 'Comunicaciones y documentación', order: 22, openMode: 'tab' }),
    mod({ name: 'Prime Access Management', clientId: 'prime-access', url: 'https://accred.digitekcloud.com:852/auth/login/pri2', categoryId: cats.SECURITY.id, initials: 'AM', color: '#B23A1E', description: 'Accesos, visitas y contratas', order: 30 }),
    mod({ name: 'Prime Capacity', clientId: 'prime-capacity', url: 'https://dashboard.sitesandstats.com', categoryId: cats.SECURITY.id, initials: 'PC', color: '#B23A1E', description: 'Gestión de aforos', order: 31, enabled: false }),
    mod({ name: 'Novedades Primion', clientId: 'novedades', url: 'https://splendorous-sable-bb85fe.netlify.app/', categoryId: cats.OTROS.id, initials: 'NP', color: '#52525B', description: 'Novedades y lanzamientos', order: 40 })
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
