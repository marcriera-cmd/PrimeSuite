# Prime Suite v2 · Prime ID

Portal de aplicaciones con **SSO propio (Prime ID)**, **integración de cualquier app por URL** y **panel de widgets**.
Frontend React + Vite. Backend en Node: en producción corre en **nuestro servidor (Docker + SQLite)**; Netlify (Functions + Blobs) queda como entorno de pruebas. No necesita base de datos externa.

El código de la aplicación está en `prime-suite/`. La carpeta `deploy/` contiene la instalación autoalojada y `scripts/` el despliegue automático.

## Producción · servidor propio con despliegue automático

- **Cada push a `main` se despliega solo** en el servidor Ubuntu (*monitoring*) mediante el workflow `.github/workflows/deploy-ubuntu.yml`, que corre en un runner autoalojado del propio servidor.
- El despliegue (`scripts/deploy-ubuntu.sh`) hace backup de los datos, reconstruye la imagen, reinicia la app y comprueba `/api/health`. Si la versión nueva no responde, **vuelve sola a la anterior**.
- Instalación inicial, HTTPS, backups y variables: [`deploy/DEPLOY.md`](deploy/DEPLOY.md). Runner: `scripts/setup-runner-ubuntu.sh`.
- Para lanzar un despliegue a mano: GitHub › Actions › *Desplegar en Ubuntu* › *Run workflow*.

---

## 1. Desplegar en Netlify (entorno de pruebas)

> En Netlify, configura **Base directory = `prime-suite`** (el código ya no está en la raíz del repo).

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

## 6. Desarrollo local

```bash
npm install
npm run dev          # API en :8888 + Vite en :5173 (abre http://localhost:5173)
```

Para probar tal cual funcionará en Netlify, en un solo puerto:

```bash
npm run build && SERVE_DIST=1 npx tsx server/dev.ts   # http://localhost:8888
```

En local los datos se guardan en `.data/` (ficheros JSON). Para empezar de cero, borra esa carpeta.

## 7. Estructura

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
  superset.ts      cliente de la API de Superset
  netguard.ts      protección SSRF en las peticiones salientes
  store.ts         SQLite (servidor) / Netlify Blobs / ficheros locales
  prod.ts          servidor de producción (Docker)
src/               frontend React
public/demo-app/   app externa de demostración
```

## 8. Seguridad incluida

- Sesión en cookie `HttpOnly; Secure; SameSite=None`, firmada RS256. Se invalida al cambiar la contraseña, cerrar sesión (single logout) o revocarla desde admin.
- Contraseñas con bcrypt y bloqueo de 5 minutos tras 5 intentos fallidos.
- OIDC: redirect URIs exactas, PKCE S256 obligatorio para clientes públicos, códigos de un solo uso (120 s) y secretos guardados con hash.
- Prime Token: un solo uso (jti), audiencia por app y caducidad corta.
- Protección CSRF por comprobación de `Origin` en la API.
- Análisis de URL y widgets protegidos contra SSRF (se bloquean redes privadas).
- Ámbito por empresa: un administrador de empresa solo ve y gestiona su tenant.
- Auditoría de logins, tokens emitidos y cambios de administración.

## 9. Limitaciones de esta versión (hoja de ruta)

- **SAML 2.0**, **Prime Gateway** (proxy de identidad para apps que no se pueden tocar) y **login con Entra ID / Google**: aparecen en la interfaz como "próximamente".
- **MFA**: pendiente.
- **Netlify Blobs** solo se usa en el entorno de pruebas. En producción los datos están en **SQLite** dentro del volumen Docker `prime-data`.
- Los módulos actuales (Evalos, Bindok, Accred…) siguen con su propio login hasta que implementen OIDC o Prime Token.
