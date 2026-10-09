# Prime Suite v2 · Prime ID

Portal de aplicaciones con **SSO propio (Prime ID)**, **integración de cualquier app por URL** y **panel de widgets**.
Frontend React + Vite, backend en Netlify Functions, datos en Netlify Blobs. No necesita base de datos externa.

---

## 1. Desplegar en Netlify

**Opción A · GitHub (recomendada)**

1. Sube esta carpeta a un repositorio de GitHub.
2. En Netlify: *Add new site › Import an existing project* y elige el repositorio.
3. Netlify lee `netlify.toml`: build `npm run build`, publica `dist`, funciones en `netlify/functions`. Pulsa *Deploy*.

**Opción B · Netlify CLI**

```bash
npm install
npx netlify-cli login
npx netlify-cli deploy --build --prod
```

No hace falta configurar variables de entorno. Netlify Blobs se activa solo.

Variables opcionales:

| Variable | Para qué |
|---|---|
| `PRIME_SECRET_KEY` | **Recomendada.** Clave con la que se cifran las contraseñas de los servidores Superset (cualquier texto largo y aleatorio). Si no existe, se genera una y se guarda en Blobs. |
| `PRIME_ISSUER` | Fija el emisor (p. ej. `https://id.primesuite.com`). Si no está, se usa el dominio de la petición. Recomendado cuando uses dominio propio, para que el issuer no cambie entre previews. |

## 2. Primera puesta en marcha

1. Abre la URL del sitio. Aparece **Configurar Prime Suite**.
2. Crea la empresa principal (p. ej. Primion / `pri5`) y tu usuario **superadministrador**.
3. Se crean automáticamente:
   - Categorías: ANALYTICS, PEOPLE, PERFORMANCE, SECURITY, OTROS.
   - Los módulos actuales de Prime Suite (con *Sin SSO*, porque aún no hablan Prime ID).
   - Dos apps de demostración para probar el SSO de punta a punta.

## 3. Qué probar

| Prueba | Dónde |
|---|---|
| SSO con **Prime Token** (JWT de un solo uso) | Aplicaciones › *Demo · Prime Token* |
| SSO con **OpenID Connect** (code + PKCE, silencioso en iframe) | Aplicaciones › *Demo · OpenID Connect* |
| Login iniciado por la app | Abre `/demo-app/` en otra ventana sin sesión › *Iniciar sesión con Prime ID* |
| Token reutilizado → rechazado | Recarga el iframe de la demo manualmente con el mismo token |
| **Asistente de integración** con análisis automático | Integraciones › Nueva › URL `/demo-app/` |
| Widgets del panel | Inicio › Personalizar panel |
| Permisos por grupo | Grupos y permisos › rol por aplicación; Usuarios › acceso efectivo |
| Cierre de sesión único | Cerrar sesión en el portal invalida las sesiones OIDC nuevas |
| Auditoría | Administración › Auditoría |

## 4. Cómo se integra una aplicación

### Opción 1 · OpenID Connect (recomendada)

Datos para el proveedor de la app:

- Discovery: `https://TU-DOMINIO/.well-known/openid-configuration`
- Client ID: el identificador de la integración
- Scopes: `openid profile email tenant roles`
- Cliente público (PKCE S256) o confidencial (client_secret, se genera en la integración)

Claims: `sub, name, given_name, family_name, preferred_username, email, tenant, company_id, company_name, roles, groups, portal_role`.

Para que el portal abra la app ya autenticada, configura **Initiate login URI**. Es una URL de la app que arranca el flujo OIDC. El portal la llama con `?iss=…&client_id=…&login_hint=…&target_link_uri=…`.

### Opción 2 · Prime Token (sustituye al `sso_token` actual)

El portal abre la app con un JWT firmado (RS256, 60 s, un solo uso), normalmente en el fragmento `#prime_token=…`. La app:

```js
import { createRemoteJWKSet, jwtVerify } from 'jose';
const JWKS = createRemoteJWKSet(new URL('https://TU-DOMINIO/.well-known/jwks.json'));

const { payload } = await jwtVerify(token, JWKS, {
  issuer: 'https://TU-DOMINIO', audience: 'CLIENT_ID', typ: 'prime+jwt'
});
// Garantiza un solo uso:
await fetch('https://TU-DOMINIO/api/sso/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
```

Entregas disponibles:

- `fragment` (recomendada)
- `form_post`
- `query`: solo por compatibilidad; admite el nombre de parámetro `sso_token`.

### Manifiesto `prime-app.json` (integración en un clic)

Si la app publica `prime-app.json` junto a su URL, o en `/.well-known/prime-app.json`, el asistente configura solo la autenticación y los widgets. Ejemplo en `public/demo-app/prime-app.json`.

### Widgets

El portal llama al endpoint **desde el servidor** con `Authorization: Bearer <token de acceso>`. Es un JWT `at+jwt` cuya audiencia es el client_id de la app y se valida con el JWKS. Formatos:

```json
KPI      { "value": 42, "label": "visitas hoy", "delta": "+8", "trend": "up" }
Lista    { "items": [{ "title": "…", "subtitle": "…", "badge": "Nuevo" }] }
Gráfico  { "series": [{ "label": "L", "value": 312 }] }
Iframe   (sin endpoint JSON: se embebe la URL)
```

## 5. Prime Insights (Superset)

Prime Insights es un **módulo nativo** del portal, no una URL embebida. Sirve para gestionar, asignar y visualizar dashboards de Superset.

1. **Servidores Superset**: URL base y un usuario de servicio. La contraseña se cifra y nunca llega al navegador. Pulsa *Probar conexión*.
2. **Importar desde Superset**: lista los dashboards del servidor y los importa de una vez. Si alguno no tiene *Embed dashboard* activado, lo activa con este portal como dominio permitido.
3. En cada dashboard configuras:
   - Categoría.
   - Empresas y grupos que lo ven.
   - Filtro RLS por empresa (p. ej. `empresa = '{tenant}'`).
   - Si se ofrece como **widget del Inicio**.
4. Al abrirlo, el backend pide a Superset un **guest token** para ese usuario y con el filtro RLS aplicado. El usuario nunca ve el login de Superset.

Lo que hay que configurar en Superset está en la pestaña *Servidores Superset › Configuración necesaria*:

- `EMBEDDED_SUPERSET`.
- `GUEST_ROLE_NAME`.
- `frame-ancestors` con el dominio del portal.

Si un dashboard solo tiene URL directa (sin UUID), se muestra en un iframe plano y Superset pedirá login.

## 6. Atajos de Evalos

**Atajos de Evalos** es un módulo nativo (`/evalos`) con las funciones principales de Evalos 8. Lee y escribe directamente en la base de datos de Evalos 8 (SQL Server, paquete `mssql`), salvo *Correcciones*, que con conexión real usa EvalosRest (la API REST de la integración Evalos8) y, para las vacaciones, los servicios SOAP ServiciosCliente (campo «URL servicios SOAP» de Integraciones › Evalos8 › API REST).

1. **Configuración** (administradores del portal, menú del propio módulo): cadena de conexión ADO.NET de la BD de Evalos 8 de cada empresa, p. ej.
   `Server=servidor,1433;Database=EVALOS8;User Id=atajos;Password=…;Encrypt=true;TrustServerCertificate=true`.
   Se guarda cifrada (AES-256-GCM, misma clave `PRIME_SECRET_KEY`) y nunca vuelve al navegador. *Probar conexión* valida el acceso y *Detectar* localiza las tablas (`DEPMENTO`, `PERSONAL`, `HIS_DEPMENTO`…) y sus columnas; la correspondencia se puede ajustar a mano.
   El servidor SQL debe ser accesible desde Netlify (Internet). Recomendado: un usuario SQL propio con permisos solo sobre las tablas que se usan.
2. **Modo demostración**: datos ficticios guardados en Blobs para probar la interfaz sin base de datos.
3. **Pantallas** (cada una es también un **widget** del Inicio):
   - *Departamentos* (Configuración › Organización › Departamentos): listado con empleados activos y de baja, alta, modificación de descripción y borrado (solo rol admin del módulo y solo si ningún empleado ni tramo de histórico lo usa).
   - *Correcciones › Marcajes*: sin conexión (demostración) usa datos ficticios. Con conexión real trabaja por EvalosRest (Integraciones › Evalos8 › API REST): anomalías del listado `PS_ANOMA` (`GET /Report/filter`), marcajes de presencia (`GET /Booking/attendance[/{empleado}]`) por periodo (máx. 31 días) y empleado, y *Corregir* añade marcajes manuales (`POST /Booking/attendance`, `Debug: "MAN"`); los marcajes de terminal no se modifican (`server/evalos/marcajesrest.ts`).
   - *Convenios*: por convenio, el día/mes de inicio y los días del periodo de vacaciones, y el día/mes de inicio del periodo de incidencias con un límite (en días u horas) por cada incidencia de `INCIDENC`. Los periodos duran un año. Se guarda en dos tablas propias en la BD de Evalos 8, `PS_CONVENIOS` y `PS_CONVENIOS_LIMITES`, que se crean con el script de `server/evalos/convenios.ts` (la propia pantalla lo muestra para copiarlo o descargarlo si aún no existen).
4. **Permisos**: rol del módulo `viewer` = consulta, `user` = alta/modificación, `admin` = además borrado. Todas las escrituras quedan en Auditoría (`evalos.*`).

Para añadir una pantalla nueva: métodos en `server/evalos/types.ts` (+ `mssql.ts` y `demo.ts`), rutas en `server/routes/evalos.ts` y su entrada en `EVALOS_SCREENS`, y el componente (página + widget) registrado en `src/pages/evalos/screens.tsx`.

## 7. Desarrollo local

```bash
npm install
npm run dev          # API en :8888 + Vite en :5173 (abre http://localhost:5173)
```

Para probar tal cual funcionará en Netlify, en un solo puerto:

```bash
npm run build && SERVE_DIST=1 npx tsx server/dev.ts   # http://localhost:8888
```

En local los datos se guardan en `.data/` (ficheros JSON). Para empezar de cero, borra esa carpeta.

## 8. Estructura

```
netlify/functions/api.mts   → /api/*, /oidc/*, /.well-known/*   (Prime ID + API del portal)
netlify/functions/demo.mts  → /demo-api/*                        (backend de la app demo)
server/
  crypto.ts        claves RS256, JWKS, rotación, sesiones, contraseñas
  routes/oidc.ts   authorize · token · userinfo · logout · lanzamiento · canje de Prime Token
  routes/admin.ts  empresas, usuarios, grupos, categorías, integraciones, identidad, auditoría
  routes/portal.ts apps del usuario, panel y proxy de widgets
  routes/analyze.ts análisis de URL (iframe, cookies, manifiesto, SAML)
  routes/insights.ts Prime Insights: servidores, dashboards, guest tokens
  routes/evalos.ts Atajos de Evalos: configuración, departamentos, widgets
  evalos/          drivers de BD de Evalos 8 (SQL Server y demostración)
  superset.ts      cliente de la API de Superset
  netguard.ts      protección SSRF en las peticiones salientes
  store.ts         Netlify Blobs / ficheros locales
src/               frontend React
public/demo-app/   app externa de demostración
```

## 9. Seguridad incluida

- Sesión en cookie `HttpOnly; Secure; SameSite=None`, firmada RS256. Se invalida al cambiar la contraseña, cerrar sesión (single logout) o revocarla desde admin.
- Contraseñas con bcrypt y bloqueo de 5 minutos tras 5 intentos fallidos.
- OIDC: redirect URIs exactas, PKCE S256 obligatorio para clientes públicos, códigos de un solo uso (120 s) y secretos guardados con hash.
- Prime Token: un solo uso (jti), audiencia por app y caducidad corta.
- Protección CSRF por comprobación de `Origin` en la API.
- Análisis de URL y widgets protegidos contra SSRF (se bloquean redes privadas).
- Ámbito por empresa: un administrador de empresa solo ve y gestiona su tenant.
- Auditoría de logins, tokens emitidos y cambios de administración.

## 10. Limitaciones de esta versión (hoja de ruta)

- **SAML 2.0**, **Prime Gateway** (proxy de identidad para apps que no se pueden tocar) y **login con Entra ID / Google**: aparecen en la interfaz como "próximamente".
- **MFA**: pendiente.
- **Netlify Blobs** va bien para pruebas y volúmenes pequeños (cientos de usuarios). Para producción se recomienda migrar `server/db.ts` a Postgres (Netlify DB / Neon); el resto del código no cambia.
- Los módulos actuales (Evalos, Bindok, Accred…) siguen con su propio login hasta que implementen OIDC o Prime Token.
