#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Prime Suite · despliegue de una versión nueva en el servidor Ubuntu
#
# Lo ejecuta el runner de GitHub Actions en cada push a main:
#   bash scripts/deploy-ubuntu.sh /ruta/del/checkout
#
# Qué hace:
#   1. Comprueba que el código es la versión autoalojada (Dockerfile, etc.).
#   2. Hace copia de seguridad de los datos (npm run backup) en /opt/primesuite/backups.
#   3. Copia el código a /opt/primesuite SIN tocar deploy/ (.env, certificados,
#      docker-compose.yml, Caddyfile) ni backups/.
#   4. Reconstruye la imagen y reinicia solo el contenedor de la app.
#   5. Comprueba /api/health; si falla, vuelve a la imagen anterior.
#
# Los datos (volumen prime-data) nunca se tocan.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SRC="${1:-${GITHUB_WORKSPACE:-}}"
INSTALL_DIR="${INSTALL_DIR:-/opt/primesuite}"
DEPLOY="$INSTALL_DIR/deploy"
BACKUPS="$INSTALL_DIR/backups"
KEEP_BACKUPS="${KEEP_BACKUPS:-15}"

ok()   { printf '\e[32m✔ %s\e[0m\n' "$*"; }
info() { printf '\e[36m→ %s\e[0m\n' "$*"; }
warn() { printf '\e[33m! %s\e[0m\n' "$*"; }
die()  { printf '\e[31m✘ %b\e[0m\n' "$*" >&2; exit 1; }

# ─── 1. Comprobaciones previas (no se toca nada si algo falla aquí) ──────────
[[ -n "$SRC" && -d "$SRC" ]] || die "Indica la carpeta del código: $0 /ruta/checkout"
[[ -f "$SRC/prime-suite/Dockerfile" ]] \
  || die "El repositorio no contiene prime-suite/Dockerfile (versión autoalojada).\nNo se despliega para no romper el servidor."
grep -q '"start"' "$SRC/prime-suite/package.json" \
  || die "prime-suite/package.json no tiene script \"start\". No se despliega."
[[ -f "$DEPLOY/docker-compose.yml" && -f "$DEPLOY/.env" ]] \
  || die "No existe $DEPLOY/docker-compose.yml o .env. Instala primero con install-primesuite-ubuntu.sh."
command -v rsync >/dev/null || die "Falta rsync (sudo apt install rsync)."
docker info >/dev/null 2>&1 || die "Este usuario no puede usar Docker (¿está en el grupo docker?)."

APP_PORT="$(grep -E '^APP_PORT=' "$DEPLOY/.env" | cut -d= -f2- || true)"
APP_PORT="${APP_PORT:-18080}"
COMMIT="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo desconocido)"
info "Desplegando commit $COMMIT en $INSTALL_DIR"

cd "$DEPLOY"
compose() { docker compose "$@"; }

# ─── 2. Copia de seguridad de los datos ──────────────────────────────────────
mkdir -p "$BACKUPS"
STAMP="$(date +%Y%m%d-%H%M%S)"
if compose ps --status running --services 2>/dev/null | grep -qx app; then
  if compose exec -T app npm run --silent backup /data/backup-predeploy.json >/dev/null 2>&1 \
     && compose cp app:/data/backup-predeploy.json "$BACKUPS/prime-suite-$STAMP.json" >/dev/null 2>&1; then
    ok "Backup: $BACKUPS/prime-suite-$STAMP.json"
  else
    warn "No se pudo hacer el backup con 'npm run backup'; se continúa (el volumen de datos no se toca)."
  fi
fi
# Conservar solo los últimos $KEEP_BACKUPS
ls -1t "$BACKUPS"/prime-suite-*.json 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -f

# Guardar la imagen actual para poder volver atrás
if docker image inspect prime-suite:latest >/dev/null 2>&1; then
  docker image tag prime-suite:latest prime-suite:previous
fi

# ─── 3. Copiar el código ─────────────────────────────────────────────────────
# --delete elimina ficheros que ya no están en el repo, pero NUNCA los excluidos.
rsync -a --delete \
  --exclude '/.git/' \
  --exclude '/.github/' \
  --exclude '/deploy/' \
  --exclude '/backups/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  "$SRC/" "$INSTALL_DIR/"
echo "$COMMIT $(date '+%F %T')" > "$INSTALL_DIR/.deployed-commit"
ok "Código actualizado"

# ─── 4. Reconstruir y reiniciar la app ───────────────────────────────────────
info "Construyendo la imagen…"
compose build app
compose up -d app
ok "Contenedor de la app reiniciado"

# ─── 5. Comprobación de salud y vuelta atrás ─────────────────────────────────
info "Esperando a que la app responda en http://127.0.0.1:$APP_PORT/api/health…"
healthy=""
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 3
done

if [[ -z "$healthy" ]]; then
  compose logs --tail=60 app || true
  if docker image inspect prime-suite:previous >/dev/null 2>&1; then
    warn "La versión nueva no responde. Volviendo a la imagen anterior…"
    docker image tag prime-suite:previous prime-suite:latest
    compose up -d --no-build app
    die "Despliegue de $COMMIT FALLIDO: se ha restaurado la versión anterior."
  fi
  die "Despliegue de $COMMIT FALLIDO y no hay imagen anterior a la que volver."
fi

ok "App OK: $(curl -fsS "http://127.0.0.1:$APP_PORT/api/health")"
docker image prune -f >/dev/null 2>&1 || true
ok "Desplegado $COMMIT"
