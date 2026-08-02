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
#   ./scripts/dc.sh twitch <args...>   Twitch CLI (serveur EventSub factice)
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
  # S'arrête à la première ligne qui n'est plus un commentaire, plutôt que sur
  # une plage figée : l'en-tête peut gagner ou perdre une commande sans que
  # l'aide se mette à recracher le début du code, ce qu'elle faisait.
  awk 'NR < 3 { next } !/^#/ { exit } { sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
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

# Twitch CLI, dans son conteneur.
#
# Le serveur EventSub factice écoute sur 127.0.0.1:8080 et se lance par
# `./scripts/twitch-mock.sh serve` ; cette commande-ci sert à tout le reste,
# `twitch event trigger …` en particulier. Voir docs/TESTING-TWITCH-CLI.md.
cmd_twitch() {
  local -a tty_flag=()
  [[ -t 0 && -t 1 ]] || tty_flag=(-T)

  compose --profile twitch run --rm --no-deps "${tty_flag[@]}" twitch-cli "$@"
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
    twitch)
      require_docker
      cmd_twitch "$@"
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
      compose --profile twitch down --remove-orphans "$@"
      ;;
    *)
      printf '\033[31merreur :\033[0m commande inconnue « %s »\n\n' "${command}" >&2
      usage >&2
      exit 64 # EX_USAGE
      ;;
  esac
}

main "$@"
