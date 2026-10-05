# Prime Suite · despliegue autoalojado (Linux + Docker + SQLite)

Guía para instalar Prime Suite en un servidor propio y poder **replicarlo** en otras instalaciones.
La app es un único contenedor Node que sirve el frontend y la API; todos los datos se guardan en
un **fichero SQLite** dentro de un volumen Docker (`/data/prime-suite.db`). No hace falta ninguna
base de datos externa.

---

## 1. Requisitos

- Un servidor **Linux** con **Docker** y **Docker Compose v2** (`docker compose`).
- **1 vCPU / 1–2 GB RAM** y ~1 GB de disco sobran.
- Un **nombre de dominio** (interno o público) y **HTTPS** (obligatorio para el SSO).
- Conectividad de red desde este servidor al **SQL Server de Evalos 8** (TCP 1433), si se va a usar
  el módulo Atajos de Evalos contra la base de datos real.

El TLS puede terminar de **dos maneras** (elige una, ver §4):
- **A)** en vuestro **balanceador/edge de Equinix** (recomendado): la app va por HTTP detrás de él.
- **B)** en la **propia app**, sirviendo HTTPS con vuestro certificado (perfil `tls` con Caddy).

---

## 2. Estructura

```
PrimeSuite/
├─ prime-suite/           # la aplicación (código + Dockerfile)
└─ deploy/                # todo lo de despliegue
   ├─ docker-compose.yml
   ├─ .env.example
   ├─ Caddyfile           # solo para el modo HTTPS directo
   └─ certs/              # (solo modo B) fullchain.pem + privkey.pem
```

---

## 3. Instalación

```bash
cd deploy
cp .env.example .env
#  edita .env:  PRIME_ISSUER (tu URL https), PRIME_SECRET_KEY (genera una larga), TZ
#  genera el secreto:  openssl rand -base64 48

docker compose up -d --build
```

La primera vez, abre la URL en el navegador: aparece el **asistente de primera configuración**
para crear la empresa principal y el superadministrador. (Si vas a **migrar** datos desde Netlify,
mira §5 y hazlo antes de crear nada.)

Comprobaciones rápidas:
```bash
docker compose ps
curl -s http://127.0.0.1:8080/api/health      # {"ok":true,...}
docker compose logs -f app
```

---

## 4. HTTPS / TLS

**Importante:** `PRIME_ISSUER` debe ser la URL **https exacta** con la que entra el usuario. Las
cookies de sesión van con `Secure`, así que sin HTTPS no se puede iniciar sesión.

### Modo A — detrás de vuestro balanceador (recomendado)
El balanceador/Equinix termina el TLS y reenvía a este host por HTTP al puerto `8080`.
Debe enviar las cabeceras `X-Forwarded-Proto: https` y `X-Forwarded-Host` (Prime Suite las usa
para construir el issuer). En `.env`:
```
APP_BIND=0.0.0.0      # si el balanceador está en otra máquina (protégelo por firewall)
APP_PORT=8080
```
No se usa el servicio `caddy`.

### Modo B — la app sirve HTTPS con vuestro certificado
```bash
mkdir -p deploy/certs
#  copia tu certificado de Equinix:
#    deploy/certs/fullchain.pem   (certificado + cadena)
#    deploy/certs/privkey.pem     (clave privada)
#  en .env:  PRIME_DOMAIN=primesuite.vuestro-dominio.com
docker compose --profile tls up -d --build
```
Caddy escucha en 443 y hace de proxy a la app. (Si tu certificado viene en `.pfx`/`.crt+.key`,
conviértelo a PEM: `openssl pkcs12 -in cert.pfx -nokeys -out fullchain.pem` y
`openssl pkcs12 -in cert.pfx -nocerts -nodes -out privkey.pem`.)

---

## 5. Migrar los datos desde Netlify

En la instalación de Netlify, con tu usuario **superadministrador**, descarga la copia:
```
https://primesuite.netlify.app/api/admin/backup
```
(se descarga un `prime-suite-backup-AAAA-MM-DD.json`).

Impórtala en el servidor nuevo **antes** de crear nada:
```bash
docker compose cp prime-suite-backup-2026-10-02.json app:/data/backup.json
docker compose exec app npm run restore /data/backup.json
docker compose restart app
```
Entra con tus mismos usuarios de las pruebas. (Nota: las contraseñas de los servidores de Superset
van cifradas con una clave interna que también se migra; si prefieres fijar `PRIME_SECRET_KEY` propia
en este servidor, vuelve a introducir esas contraseñas en Prime Insights › Servidores tras migrar.)

> Más adelante, para una **exportación limpia** (catálogo de módulos sin datos de clientes) añadiremos
> una opción al backup; de momento `/api/admin/backup` exporta todo.

---

## 6. Actualizar a una versión nueva

```bash
cd PrimeSuite && git pull            # o sustituye los ficheros por la versión nueva
cd deploy && docker compose up -d --build
```
Los datos persisten en el volumen `prime-data`; la actualización no los toca.

---

## 7. Copias de seguridad

Todo está en un fichero. Dos opciones:

```bash
# a) copiar el fichero SQLite (hazlo con el contenedor parado o usa el backup lógico de abajo)
docker compose cp app:/data/prime-suite.db ./prime-suite-$(date +%F).db

# b) backup lógico en JSON (en caliente)
docker compose exec app npm run backup /data/backup.json
docker compose cp app:/data/backup.json ./prime-suite-$(date +%F).json
```
Restaurar: `npm run restore /data/backup.json` (ver §5).

---

## 8. Módulo Atajos de Evalos

- Desde **Administración › Atajos de Evalos › Configuración** se elige el motor: **Demostración**
  (datos ficticios) o **SQL Server** (la base de datos real de Evalos 8).
- Para el modo real, introduce la cadena de conexión, p. ej.:
  ```
  Server=TU-SQLSERVER,1433;Database=EVALOS8;User Id=atajos;Password=****;Encrypt=true;TrustServerCertificate=true
  ```
  Usa un usuario de SQL Server propio con permisos solo sobre las tablas necesarias.
- Requiere que este servidor **alcance** al SQL Server por TCP 1433 (regla de firewall/VPN).

---

## 9. Problemas frecuentes

| Síntoma | Causa / solución |
|---|---|
| No deja iniciar sesión, vuelve al login | `PRIME_ISSUER` no coincide con la URL real, o no llega por HTTPS. Revisa el dominio y que el proxy mande `X-Forwarded-Proto: https`. |
| "Error interno" en todo | Revisa `docker compose logs app`. Normalmente permisos del volumen `/data`. |
| Superset no carga / no conecta | Es herramienta interna: `PRIME_ALLOW_PRIVATE_FETCH=1` ya va activado para permitir URLs de red privada. Revisa que el host de Superset sea alcanzable. |
| Evalos (modo real) da error de conexión | Falta ruta al SQL Server (1433) o la cadena de conexión es incorrecta. |

---

## 10. Variables de entorno (resumen)

| Variable | Para qué |
|---|---|
| `PRIME_ISSUER` | URL https pública/interna exacta (issuer del SSO). **Obligatoria.** |
| `PRIME_SECRET_KEY` | Clave para cifrar secretos (Superset). Larga, aleatoria, estable. |
| `APP_PORT` / `APP_BIND` | Puerto interno y a qué interfaz del host se publica. |
| `PRIME_DOMAIN` | Dominio para el modo HTTPS directo (perfil `tls`). |
| `TZ` | Zona horaria del contenedor. |
| `PRIME_STORE` / `PRIME_SQLITE_PATH` | Almacenamiento SQLite. No cambiar. |
