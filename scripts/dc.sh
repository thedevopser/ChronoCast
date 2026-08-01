#!/usr/bin/env bash
#
# Point d'entrée unique des commandes de développement de ChronoCast.
#
# Aucun binaire Node n'est installé sur la machine hôte : tout s'exécute dans un
# conteneur. Ce script masque la verbosité de docker compose et garantit que
# chacun lance les commandes de la même manière.
#
#   ./scripts/dc.sh install            installe les dépendances (npm ci)
#   ./scripts/dc.sh lint               ESLint
#   ./scripts/dc.sh typecheck          tsc --noEmit
#   ./scripts/dc.sh test [motif...]    suite de tests Vitest
#   ./scripts/dc.sh test:watch         Vitest en mode watch
#   ./scripts/dc.sh audit              npm audit (seuil : high)
#   ./scripts/dc.sh verify             lint + typecheck + test + audit
#   ./scripts/dc.sh build              compilation TypeScript
#   ./scripts/dc.sh build:win          installeur Windows NSIS
#   ./scripts/dc.sh shell              shell interactif dans le conteneur
#   ./scripts/dc.sh npm <args...>      commande npm arbitraire
#   ./scripts/dc.sh down               arrête et nettoie les conteneurs

set -euo pipefail

# Résolution du dépôt indépendamment du répertoire courant de l'appelant.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname -- "${SCRIPT_DIR}")"
COMPOSE_FILE="${REPO_ROOT}/docker/compose.yml"

readonly SCRIPT_DIR REPO_ROOT COMPOSE_FILE

# --- Programmation défensive : vérifier l'environnement avant toute action -----

die() {
  printf '\033[31merreur :\033[0m %s\n' "$*" >&2
  exit 1
}

info() {
  printf '\033[36m▸\033[0m %s\n' "$*"
}

require_docker() {
  command -v docker >/dev/null 2>&1 \
    || die "docker est introuvable. ChronoCast se développe exclusivement en conteneur."

  docker compose version >/dev/null 2>&1 \
    || die "le plugin 'docker compose' est introuvable. Installez Docker Compose v2 ou supérieur."

  docker info >/dev/null 2>&1 \
    || die "le démon Docker ne répond pas. Démarrez-le puis relancez la commande."

  [[ -f "${COMPOSE_FILE}" ]] \
    || die "fichier compose introuvable : ${COMPOSE_FILE}"
}

compose() {
  docker compose --file "${COMPOSE_FILE}" "$@"
}

# Exécute une commande dans le service `dev`.
#
# --rm         : pas de conteneur résiduel après exécution.
# --no-deps    : n'entraîne pas le démarrage des services auxiliaires.
# -T lorsque   : la sortie n'est pas un terminal (CI), pour éviter l'échec
#                d'allocation de TTY.
dev_run() {
  local -a tty_flag=()
  [[ -t 0 && -t 1 ]] || tty_flag=(-T)
  compose run --rm --no-deps "${tty_flag[@]}" dev "$@"
}

# Vérifie que les dépendances ont été installées avant d'exécuter un outil qui
# en dépend : un message explicite vaut mieux qu'un « command not found ».
require_dependencies() {
  if ! dev_run test -d /app/node_modules/.bin 2>/dev/null; then
    die "dépendances absentes. Lancez d'abord : ./scripts/dc.sh install"
  fi
}

usage() {
  sed -n '3,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# --- Commandes ----------------------------------------------------------------

cmd_install() {
  info "installation des dépendances (npm ci)"
  # --ignore-scripts : aucun script post-install de dépendance tierce n'est
  # exécuté, ce qui ferme une voie d'attaque classique de la chaîne
  # d'approvisionnement. Aucune dépendance de production n'en a besoin.
  if [[ -f "${REPO_ROOT}/package-lock.json" ]]; then
    dev_run npm ci --ignore-scripts "$@"
  else
    info "package-lock.json absent : utilisation de 'npm install' pour le générer"
    dev_run npm install --ignore-scripts "$@"
  fi
}

cmd_build_win() {
  info "construction de l'installeur Windows NSIS (Wine)"

  local -a tty_flag=()
  [[ -t 0 && -t 1 ]] || tty_flag=(-T)

  # Le conteneur de packaging s'exécute en root ; les artefacts produits dans le
  # volume monté appartiendraient donc à root sur l'hôte. On restitue la
  # propriété à l'utilisateur appelant en fin de construction.
  compose --profile build run --rm "${tty_flag[@]}" build-win bash -euo pipefail -c "
    npm ci
    npm run build
    npx electron-builder --windows --publish never
    chown -R $(id -u):$(id -g) /project/release /project/dist 2>/dev/null || true
  "

  info "artefacts disponibles dans ./release"
  ls -lh "${REPO_ROOT}/release" 2>/dev/null || true
}

main() {
  local command="${1:-help}"
  [[ $# -gt 0 ]] && shift

  case "${command}" in
    help | --help | -h)
      usage
      ;;
    install)
      require_docker
      cmd_install "$@"
      ;;
    lint)
      require_docker && require_dependencies
      dev_run npm run lint "$@"
      ;;
    typecheck)
      require_docker && require_dependencies
      dev_run npm run typecheck "$@"
      ;;
    test)
      require_docker && require_dependencies
      dev_run npm run test -- "$@"
      ;;
    test:watch)
      require_docker && require_dependencies
      dev_run npm run test:watch -- "$@"
      ;;
    audit)
      require_docker && require_dependencies
      dev_run npm audit --audit-level=high "$@"
      ;;
    verify)
      require_docker && require_dependencies
      info "lint"      && dev_run npm run lint
      info "typecheck" && dev_run npm run typecheck
      info "tests"     && dev_run npm run test
      info "audit"     && dev_run npm audit --audit-level=high
      info "vérification complète réussie"
      ;;
    build)
      require_docker && require_dependencies
      dev_run npm run build "$@"
      ;;
    build:win)
      require_docker
      cmd_build_win "$@"
      ;;
    shell)
      require_docker
      dev_run bash "$@"
      ;;
    npm)
      require_docker
      dev_run npm "$@"
      ;;
    down)
      require_docker
      compose --profile build --profile twitch down --remove-orphans "$@"
      ;;
    *)
      printf '\033[31merreur :\033[0m commande inconnue « %s »\n\n' "${command}" >&2
      usage >&2
      exit 64 # EX_USAGE
      ;;
  esac
}

main "$@"
