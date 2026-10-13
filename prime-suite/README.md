# Prime Suite v2 · Prime ID

Portal de aplicaciones con **SSO propio (Prime ID)**, **integración de cualquier app por URL**, **panel de widgets** y módulos nativos (**Prime Insights** y **Atajos de Evalos**).
Frontend React + Vite y backend Node/TypeScript. No necesita base de datos externa: en producción los datos del portal están en SQLite.

---

## 1. Despliegue

### Producción · servidor Ubuntu propio (Docker + SQLite)

- **Cada push a `main` se despliega solo** en el servidor Ubuntu (`/opt/primesuite`) con el workflow `.github/workflows/deploy-ubuntu.yml` («Desplegar en Ubuntu»), que corre en un runner autoalojado del propio servidor.
- `scripts/deploy-ubuntu.sh` hace backup de los datos, reconstruye la imagen, reinicia la app y comprueba `/api/health`. Si la versión nueva no responde, vuelve sola a la anterior.
- La app es un único contenedor (`server/prod.ts`) que sirve la API y el frontend compilado. Los datos van en `/data/prime-suite.db` dentro del volumen Docker `prime-data`.
- Instalación inicial, HTTPS, backups y migración desde Netlify: [`../deploy/DEPLOY.md`](../deploy/DEPLOY.md).

Variables de entorno (en `deploy/.env` del servidor; nunca en el repo):

| Variable | Para qué |
|---|---|
| `PRIME_ISSUER` | **Obligatoria.** URL https exacta con la que se entra al portal, sin barra final. Es el issuer del SSO. |
| `PRIME_SECRET_KEY` | Clave con la que se cifran todos los secretos guardados (AES-256-GCM): contraseñas de Superset, Client Secret de la API REST, cadenas de conexión de Evalos, credenciales del inicio automático. Larga, aleatoria y **estable** (si cambia, lo cifrado deja de poder leerse). |
| `PRIME_STORE` / `PRIME_SQLITE_PATH` | Almacenamiento (`sqlite`, `/data/prime-suite.db`). Los fija el Dockerfile; no cambiar. |
| `PRIME_ALLOW_PRIVATE_FETCH` | `1` = las salidas del servidor (`safeFetch`) pueden llegar a redes privadas (Superset, Evalos internos…). `server/prod.ts` lo activa por defecto. |
| `TWON_UPSTREAM` / `TWON_TLS_FINGERPRINT` | Destino del proxy de 2N Access Commander y huella SHA-256 de su certificado. |
| `EVALOS_TZ` | Zona horaria de las fechas de Evalos (por defecto `Europe/Madrid`). |
| `TZ` | Zona horaria del contenedor. |

### Pruebas · Netlify (opcional)

El mismo código funciona en Netlify (Functions + Blobs) como entorno de pruebas: *Base directory* = `prime-suite`; Netlify lee `netlify.toml` (build `npm run build`, publica `dist`, funciones en `netlify/functions`). No hace falta ninguna variable; `PRIME_SECRET_KEY` y `PRIME_ISSUER` son recomendables.

## 2. Primera puesta en marcha

1. Abre la URL del portal. Aparece **Configurar Prime Suite**.
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
| Log de inicio de sesión de una integración | Integraciones › (app) › *Ver log de inicio de sesión* |
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

Integraciones con OIDC en uso:

- **evalos8** (Evalos 8): OIDC, más la pestaña *API REST* para EvalosRest y los servicios SOAP (ver §6).
- **myevalos** (app MyEvalos): al iniciar sesión, la app busca el email del usuario en `EM_WFEM` de `PERSONAL`.

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

### Opción 3 · Inicio de sesión automático (apps sin SSO)

Mientras una app no habla Prime ID, el portal puede entrar por el usuario enviando su formulario de login o abriendo una URL con las credenciales (`server/autologin.ts`). Las credenciales se guardan cifradas, **por usuario** (cada persona guarda las suyas la primera vez) o **compartidas** (cuenta común configurada en la integración).

### Otras piezas de la integración

- **Log de inicio de sesión** (`server/ssotrace.ts`, `src/components/SsoTrace.tsx`): si la integración lo tiene activado, Prime ID apunta cada paso del login con esa app (qué pide, qué comprueba, qué usuario identifica y qué claims envía). Nunca guarda secretos ni tokens firmados.
- **Pestaña API REST** (`server/apirest.ts`, `src/pages/admin/moduleForm.tsx`): datos para que Prime Suite llame a la API de la app con OAuth2 client credentials: URL API, URL token, Client ID y Client Secret (cifrado; el formulario solo sabe si existe), con *Probar conexión*. También tiene **URL servicios SOAP** con *Probar servicios SOAP*.
- **2N Access Commander** (`server/proxy2n.ts`): proxy inverso bajo `/2n/` del mismo origen que el portal, para que la cookie de sesión de 2N (SameSite=Strict) funcione dentro del iframe. El destino es fijo (`TWON_UPSTREAM`) y el certificado se valida por huella (`TWON_TLS_FINGERPRINT`).

### Manifiesto `prime-app.json` (integración en un clic)

Si la app publica `prime-app.json` junto a su URL, o en `/.well-known/prime-app.json`, el asistente configura solo la autenticación y los widgets (`server/routes/analyze.ts`). Ejemplo en `public/demo-app/prime-app.json`.

### Widgets

El portal llama al endpoint **desde el servidor** con `Authorization: Bearer <token de acceso>`. Es un JWT `at+jwt` cuya audiencia es el client_id de la app y se valida con el JWKS. Formatos:

```json
KPI      { "value": 42, "label": "visitas hoy", "delta": "+8", "trend": "up" }
Lista    { "items": [{ "title": "…", "subtitle": "…", "badge": "Nuevo" }] }
Gráfico  { "series": [{ "label": "L", "value": 312 }] }
Iframe   (sin endpoint JSON: se embebe la URL)
```

## 5. Prime Insights (Superset)

Prime Insights es un **módulo nativo** del portal, no una URL embebida. Sirve para gestionar, asignar y visualizar dashboards de Superset (`server/routes/insights.ts`, `server/superset.ts`).

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

**Atajos de Evalos** es un módulo nativo (`/evalos`) con las funciones principales de Evalos 8 (`server/routes/evalos.ts`, `server/routes/teletrabajo.ts`, `server/evalos/*`, `src/pages/evalos/*`). Cada pantalla es también un **widget** del Inicio.

### Fuentes de datos

| Fuente | Qué se usa | Dónde se configura |
|---|---|---|
| **BD SQL Server de Evalos 8** (`server/evalos/mssql.ts`, paquete `mssql`) | Departamentos, Personal y sus históricos, Convenios, catálogos (`INCIDENC`, `TIPOSVACACIONES`, `GESTURNO`, `KIOSKO`, `WORKFLOW`), `USUARIOS`, y lo que Teletrabajo lee de Evalos | Atajos de Evalos › Configuración |
| **EvalosRest** (`server/evalosrest.ts`) | Correcciones con conexión real: anomalías, marcajes, ausencias y turno del día | Integraciones › evalos8 › API REST |
| **SOAP ServiciosCliente** (`server/evalossoap.ts`) | Vacaciones del día en Correcciones | Integraciones › evalos8 › API REST › URL servicios SOAP |
| **Almacén de Prime Suite** | Teletrabajo (planificación, políticas, bolsas) y el modo demostración | — |

- **Configuración** (administradores del portal, menú del propio módulo): por empresa, motor **Demostración** (`server/evalos/demo.ts`, datos ficticios) o **SQL Server** con la cadena de conexión ADO.NET, p. ej.
  `Server=servidor,1433;Database=EVALOS8;User Id=atajos;Password=…;Encrypt=true;TrustServerCertificate=true`.
  Se guarda cifrada y nunca vuelve al navegador. *Probar conexión* valida el acceso y *Detectar* localiza las tablas y sus columnas; la correspondencia se puede ajustar a mano. El servidor de Prime Suite debe alcanzar el SQL Server (TCP 1433). Recomendado: un usuario SQL propio con permisos solo sobre las tablas que se usan.
- **EvalosRest**: OAuth2 client credentials; el token se cachea, se comparte entre llamadas simultáneas y se renueva ante un 401. Las rutas son relativas a `/api/v1`. Documentación: Swagger en `https://evalos-c.digitekcloud.com:813/Digitek/EvalosRest/swagger/docs/v1` y la colección Postman en `…/Digitek/EvalosRest/PostmanCollection/`.
- **SOAP ServiciosCliente** (p. ej. `https://evalos-d.digitekcloud.com/Digitek/suiteclient133/servicioscliente.asmx`): no pide autenticación. Lee del WSDL el espacio de nombres y los parámetros de cada operación y los rellena por su significado. `EmpresaConexion` = los dígitos tras «suiteclient» en la URL. `callEvalosSoap(op, valores)` devuelve el texto del resultado: «Ok», vacío o `true` = correcto.
- Cuando un servicio externo no documenta los formatos, se lee de forma tolerante (varios formatos, campos por varios nombres) y la pantalla ofrece **«Ver respuesta»** para diagnosticar con datos reales.

### Pantallas

- **Departamentos**: listado con empleados activos y de baja, alta, modificación de la descripción y borrado (solo rol admin del módulo y solo si ningún empleado ni tramo de histórico lo usa).
- **Personal** (`server/evalos/personal.ts`, `history.ts`, `employees.ts`): alta, modificación y eliminación sobre `PERSONAL`.
  - Códigos de empleado de 10 dígitos y tarjetas de 10 caracteres alfanuméricos en mayúsculas, rellenados con ceros a la izquierda. `EM_WFEM` en mayúsculas.
  - En el alta: `EM_CACC='999'`, `EM_CAUT='001'` y `EM_TURN='DEF'`.
  - Históricos `HIS_TARJETA`, `HIS_EMPRESA`, `HIS_DEPMENTO`, `HIS_SECCION` y `HIS_AREA` con un motor común; nunca se usan las tablas `MOV_*`. Tarjetas: varias por empleado, ninguna vigente en dos empleados. Organización: un solo tramo vigente; al cambiar, el anterior se cierra el día antes.
  - Baja: cierra todos los tramos y el periodo en `HIS_VIGENCIA`. *Volver a dar de alta* abre un periodo nuevo con el formulario vacío.
  - Consultas = `KIOSKO` (`KI_KOPC` → `EM_KOPC`) y Solicitudes = `WORKFLOW` (`WF_CODI` → `EM_WFOP`), solo valores existentes. Desplegable «Convenio» (`EM_CONV`).
- **Calendarios**: calendarios laborales y festivos (nacional, autonómico, local, empresa). Hoy solo funciona con el motor de demostración; con SQL Server la pantalla avisa de que el mapeo a la BD real está pendiente.
- **Convenios** (`server/evalos/convenios.ts`, `convperiods.ts`):
  - **Periodos de vacaciones**: tantos como se quiera por convenio (tipo de `TIPOSVACACIONES`, día/mes de inicio y días). Desde la misma ventana se pueden crear tipos nuevos.
  - **Periodo de incidencias**: día/mes de inicio y un límite **en horas** por cada incidencia de `INCIDENC`. Los límites guardados antiguamente en días se muestran pasados a horas, a 8 h por día, hasta que se vuelve a guardar el convenio.
  - **Pluses por antigüedad** en cada periodo de vacaciones (días) y en cada límite (horas): a partir de N años, X más. Los periodos duran un año.
  - **Tablas propias** en la BD de Evalos 8: `PS_CONVENIOS`, `PS_CONVENIOS_VACACIONES`, `PS_CONVENIOS_LIMITES` y `PS_CONVENIOS_PLUSES`. Si falta alguna, la pantalla muestra el script para crearla.
  - **Asignar personal** (`EM_CONV` de `PERSONAL`):
    - desde la ventana del convenio: buscar y añadir, añadir o quitar en bloque por empresa, departamento, sección o área, y quitar una a una; se aplica al guardar;
    - o desde la ficha de Personal.
  - No se puede eliminar un convenio con personas asignadas.
  - **Periodos por persona**: al entrar en un convenio (o al modificarlo) se crean o actualizan los de cada persona en alta en `VACACIONES` e `INCIDENCIALIMITE`.
    - Periodo en curso de un año. Si el alta cae dentro, empieza en la fecha de alta y se prorratea: vacaciones al medio día, límites al minuto.
    - Se suma el plus del tramo de antigüedad más alto alcanzado al inicio del periodo.
    - `TOTALHORAS` = días × 8 h (provisional).
    - Una fila existente se actualiza sin tocar lo disfrutado; quitar a alguien del convenio no borra sus periodos.
    - *Generar periodos del año siguiente* crea los del periodo siguiente.
    - Se avisa, en el convenio y en la ficha, cuando lo disfrutado supera lo disponible.
- **Teletrabajo** (`server/evalos/telework.ts`):
  - Planificación diaria Oficina / Teletrabajo / Mixto (con horas), con patrones y comprobación antes de guardar.
  - Políticas (cupo por semana, mes, trimestre o año; días preferentes; mínimo presencial), asignaciones con vigencia y acuerdo de trabajo a distancia, y bolsas: cupo − consumido − planificado.
  - Aforo de la oficina, informe y widget «hoy».
  - Se guarda en Prime Suite. De Evalos lee empleados, departamentos, festivos y ausencias.
  - Avisa del teletrabajo regular sin acuerdo firmado (Ley 10/2021: más del 30 % de la jornada en 3 meses).
- **Correcciones** (`server/evalos/marcajesrest.ts`): sin conexión usa datos de demostración (incluye solicitudes y ausencias de ejemplo). Con conexión real, por EvalosRest y SOAP:
  - **Anomalías**: listado `PS_ANOMA` con `GET /Report/filter`. El parámetro `filter` es obligatorio; sin empleado se envía `EM_CODI<>''`. La respuesta trae `header [{Number,Value}]` + `body [{columns}]`. La anomalía es el título de la columna cuando vale 1 o algo distinto de cero; se ignora `TIPO`.
  - **Marcajes**: `GET /Booking/attendance[/{empleado}]` con fechas dd/mm/aaaa.
    - Se ven todos los días del periodo (máx. 31), solo de personal que existe en `PERSONAL`, y la tabla se ordena por cualquier columna.
  - **Grabar**: `POST /Booking/attendance`.
    - Los marcajes de terminal solo cambian la incidencia.
    - Los manuales también cambian la hora (se borran y se crean de nuevo).
  - **Borrar**: `DELETE /Booking/attendance?id&date&time`. Solo para el rol admin del módulo, con comprobación posterior.
  - **Incidencias**: tabla `INCIDENC` (`IN_CODI`/`IN_DESC`/`IN_TIPO`). La 000 «Entrada / Salida» va siempre la primera; 0/00 se muestran igual.
  - **Ausencia del día**: incidencias de tipo A.
    - Asignar: `PUT /Absence` (desde = hasta = el día).
    - Quitar: `DELETE /Absence/{empleado}?dateAdd=aaaammdd`.
    - `GET /Absence` da 404 si no hay.
  - **Vacaciones del día**: tipos de `TIPOSVACACIONES`, con SOAP `AsignarDiaVacaciones` / `BorrarVacaciones` (fecha dd/mm/aaaa).
  - **Turno / ausencia / vacaciones del día**: `GET /Calendar` («...» = vacío).
    - Se muestra una sola cosa, por este orden: ausencia > vacaciones > turno.
    - Con la descripción y el color de `INCIDENC` / `TIPOSVACACIONES` / `GESTURNO`.

### Usuarios del portal y Evalos

- El usuario del portal tiene un campo «Nombre completo» y se puede dar de alta a la vez como **empleado vinculado** en `PERSONAL` (nombre y email se copian a `EM_NOMB` y `EM_WFEM`).
- Los usuarios con rol de portal distinto de «Usuario» tienen registro en la tabla `USUARIOS` de Evalos (`server/evalos/users.ts`); con rol «Usuario», no. Si la empresa aún no tiene conexión, el alta queda pendiente y se hace al guardar la conexión. Un fallo aquí nunca impide crear el usuario en el portal.

### Permisos

Rol del módulo `viewer` = consulta, `user` = alta/modificación, `admin` = además borrado. La Configuración es solo para administradores del portal. Todas las escrituras quedan en Auditoría (`evalos.*`).

### Añadir una pantalla nueva

1. Entrada en `EVALOS_SCREENS` y rutas `/api/evalos/<clave>` en `server/routes/evalos.ts`.
2. Métodos en `server/evalos/types.ts`, implementados en `mssql.ts` y `demo.ts` (o, si va por API, un módulo propio como `marcajesrest.ts`).
3. Componente (página + widget) registrado en `src/pages/evalos/screens.tsx`.

## 7. Desarrollo local

```bash
npm install
npm run dev          # API en :8888 + Vite en :5173 (abre http://localhost:5173)
```

Para probar en un solo puerto, como en producción:

```bash
npm run build && SERVE_DIST=1 npx tsx server/dev.ts   # http://localhost:8888
```

En local los datos se guardan en `.data/` (ficheros JSON). Para empezar de cero, borra esa carpeta.

Comprobaciones:

```bash
npm test                                   # node --import tsx --test server/*.test.ts
npx tsc -p tsconfig.server.json --noEmit   # backend
npm run typecheck                          # frontend + backend
```

## 8. Estructura

```
server/
  app.ts · prod.ts · dev.ts   montaje de rutas · servidor de producción (Docker) · servidor de desarrollo
  http.ts          router propio (Router, json, body, HttpError)
  access.ts        contexto de la petición, permisos (requireUser / requireAdmin / requireSuper, moduleRole) y claims
  db.ts · store.ts modelo de datos sobre KV · almacenamiento SQLite (servidor) / Netlify Blobs / ficheros locales
  crypto.ts        claves RS256, JWKS, rotación, sesiones, contraseñas, cifrado de secretos
  netguard.ts      safeFetch: protección SSRF en todas las peticiones salientes
  routes/
    auth.ts        primera configuración, login, logout y perfil
    oidc.ts        Prime ID: authorize · token · userinfo · logout · lanzamiento · canje de Prime Token
    admin.ts       empresas, usuarios, grupos, categorías, integraciones, identidad, auditoría, backup
    portal.ts      apps del usuario, panel y proxy de widgets
    analyze.ts     análisis de URL (iframe, cookies, manifiesto, SAML)
    insights.ts    Prime Insights: servidores, dashboards, guest tokens
    evalos.ts      Atajos de Evalos: configuración y pantallas
    teletrabajo.ts Atajos de Evalos · Teletrabajo
  evalos/          drivers (mssql.ts, demo.ts), tipos y lógica de cada pantalla
  evalosrest.ts · evalossoap.ts   clientes de EvalosRest y de ServiciosCliente (SOAP)
  apirest.ts · ssotrace.ts · autologin.ts · proxy2n.ts · superset.ts
  tools/           backup y restore
  *.test.ts        tests (node:test)
netlify/functions/ api.mts y demo.mts (solo para el entorno de pruebas en Netlify)
src/
  api.ts           cliente HTTP y tipos compartidos
  components/ui.tsx  Modal, useData, useToast, Icon, ErrorBox…
  pages/           portal, admin/, insights/, evalos/
  styles.css
public/demo-app/   app externa de demostración
```

## 9. Seguridad incluida

- Sesión en cookie `HttpOnly; Secure; SameSite=None`, firmada RS256. Se invalida al cambiar la contraseña, cerrar sesión (single logout) o revocarla desde admin.
- Contraseñas con bcrypt y bloqueo de 5 minutos tras 5 intentos fallidos.
- OIDC: redirect URIs exactas, PKCE S256 obligatorio para clientes públicos, códigos de un solo uso (120 s) y secretos guardados con hash.
- Prime Token: un solo uso (jti), audiencia por app y caducidad corta.
- Protección CSRF por comprobación de `Origin` en la API.
- Todas las salidas a Internet pasan por `safeFetch` (protección SSRF).
- Secretos cifrados con AES-256-GCM (`PRIME_SECRET_KEY`); nunca vuelven al navegador.
- Ámbito por empresa: un administrador de empresa solo ve y gestiona su tenant.
- Auditoría de logins, tokens emitidos, cambios de administración y escrituras en Evalos.

## 10. Limitaciones y pendientes

- **SAML 2.0**, **Prime Gateway** (proxy de identidad para apps que no se pueden tocar) y **login con Entra ID / Google**: aparecen en la interfaz como «próximamente».
- **MFA**: pendiente.
- Los módulos que no hablan OIDC ni Prime Token siguen con su propio login (o con el inicio de sesión automático).
- Atajos de Evalos:
  - Calendarios contra la BD real.
  - Endurecer el email de MyEvalos: no permitir `EM_WFEM` repetido, bloquear la edición del email desde Personal en empleados vinculados y autovincular por email.
  - Acción para crear los tramos iniciales a empleados antiguos sin históricos.
  - Correcciones:
    - Quitar ausencias asignadas desde el calendario o en periodos de varios días.
    - Confirmar con datos reales el borrado de marcajes y las vacaciones por SOAP.
