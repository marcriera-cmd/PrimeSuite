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

## 5. Desarrollo local

```bash
npm install
npm run dev          # API en :8888 + Vite en :5173 (abre http://localhost:5173)
```

Para probar tal cual funcionará en Netlify, en un solo puerto:

```bash
npm run build && SERVE_DIST=1 npx tsx server/dev.ts   # http://localhost:8888
```

En local los datos se guardan en `.data/` (ficheros JSON). Para empezar de cero, borra esa carpeta.

## 6. Estructura

```
netlify/functions/api.mts   → /api/*, /oidc/*, /.well-known/*   (Prime ID + API del portal)
netlify/functions/demo.mts  → /demo-api/*                        (backend de la app demo)
server/
  crypto.ts        claves RS256, JWKS, rotación, sesiones, contraseñas
  routes/oidc.ts   authorize · token · userinfo · logout · lanzamiento · canje de Prime Token
  routes/admin.ts  empresas, usuarios, grupos, categorías, integraciones, identidad, auditoría
  routes/portal.ts apps del usuario, panel y proxy de widgets
  routes/analyze.ts análisis de URL (iframe, cookies, manifiesto, SAML)
  netguard.ts      protección SSRF en las peticiones salientes
  store.ts         Netlify Blobs / ficheros locales
src/               frontend React
public/demo-app/   app externa de demostración
```

## 7. Seguridad incluida

- Sesión en cookie `HttpOnly; Secure; SameSite=None`, firmada RS256. Se invalida al cambiar la contraseña, cerrar sesión (single logout) o revocarla desde admin.
- Contraseñas con bcrypt y bloqueo de 5 minutos tras 5 intentos fallidos.
- OIDC: redirect URIs exactas, PKCE S256 obligatorio para clientes públicos, códigos de un solo uso (120 s) y secretos guardados con hash.
- Prime Token: un solo uso (jti), audiencia por app y caducidad corta.
- Protección CSRF por comprobación de `Origin` en la API.
- Análisis de URL y widgets protegidos contra SSRF (se bloquean redes privadas).
- Ámbito por empresa: un administrador de empresa solo ve y gestiona su tenant.
- Auditoría de logins, tokens emitidos y cambios de administración.

## 8. Limitaciones de esta versión (hoja de ruta)

- **SAML 2.0**, **Prime Gateway** (proxy de identidad para apps que no se pueden tocar) y **login con Entra ID / Google**: aparecen en la interfaz como "próximamente".
- **MFA**: pendiente.
- **Netlify Blobs** va bien para pruebas y volúmenes pequeños (cientos de usuarios). Para producción se recomienda migrar `server/db.ts` a Postgres (Netlify DB / Neon); el resto del código no cambia.
- Los módulos actuales (Evalos, Bindok, Accred…) siguen con su propio login hasta que implementen OIDC o Prime Token.
