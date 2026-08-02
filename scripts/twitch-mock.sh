#!/usr/bin/env bash
#
# Pilote le serveur EventSub factice de la Twitch CLI.
#
# Il évite d'attendre qu'un vrai spectateur s'abonne pour vérifier que le
# compteur s'incrémente. Le serveur parle le même protocole que Twitch —
# `session_welcome`, `session_keepalive`, `notification` — et ChronoCast n'a pas
# à savoir qu'il n'est pas en face du vrai.
#
#   ./scripts/twitch-mock.sh serve              démarre le serveur (au premier plan)
#   ./scripts/twitch-mock.sh trigger <event>    déclenche un événement
#   ./scripts/twitch-mock.sh scenario           enchaîne les quatre événements du barème
#   ./scripts/twitch-mock.sh stop               arrête le conteneur
#
# Marche à suivre complète : docs/TESTING-TWITCH-CLI.md

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname -- "${SCRIPT_DIR}")"
DC="${SCRIPT_DIR}/dc.sh"

readonly SCRIPT_DIR REPO_ROOT DC

# Le serveur factice écoute ici. C'est cette URL qu'il faut poser dans
# `twitch.eventsubUrl`, à la place de `wss://eventsub.wss.twitch.tv/ws`.
readonly MOCK_URL="ws://127.0.0.1:8080/ws"

# Événements couverts par le barème, dans l'ordre où ils comptent pour un
# subathon. `--transport=websocket` est indispensable : sans lui, la CLI vise
# les webhooks, que ChronoCast n'implémente pas et n'implémentera pas.
readonly -a SCENARIO=(
  subscribe
  subscription-message
  subscription-gift
  cheer
)

die() {
  printf '\033[31merreur :\033[0m %s\n' "$*" >&2
  exit 1
}

info() {
  printf '\033[36m▸\033[0m %s\n' "$*"
}

usage() {
  awk 'NR < 3 { next } !/^#/ { exit } { sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
}

cmd_serve() {
  info "serveur EventSub factice sur ${MOCK_URL}"
  info "posez cette URL dans twitch.eventsubUrl, puis redémarrez ChronoCast"
  info "Ctrl-C pour arrêter"

  # Au premier plan volontairement : le serveur journalise chaque connexion et
  # chaque notification, et c'est la moitié de l'intérêt de la manœuvre.
  docker compose --file "${REPO_ROOT}/docker/compose.yml" --profile twitch up twitch-cli
}

cmd_trigger() {
  local event="${1:-}"
  [[ -n "${event}" ]] || die "événement attendu. Exemple : ./scripts/twitch-mock.sh trigger subscribe"
  shift

  info "déclenchement : ${event}"
  "${DC}" twitch event trigger "${event}" --transport=websocket "$@"
}

cmd_scenario() {
  info "enchaînement des quatre événements du barème"

  for event in "${SCENARIO[@]}"; do
    cmd_trigger "${event}"
    # Les notifications sont dédupliquées par `message_id`, qui change à chaque
    # tir : la pause n'est pas là pour éviter un doublon, mais pour qu'on voie
    # le compteur bouger quatre fois plutôt qu'une.
    sleep 1
  done

  info "terminé : le compteur doit avoir été crédité quatre fois"
}

cmd_stop() {
  info "arrêt du conteneur twitch-cli"
  "${DC}" down
}

main() {
  local command="${1:-help}"
  [[ $# -gt 0 ]] && shift

  case "${command}" in
    help | --help | -h) usage ;;
    serve) cmd_serve ;;
    trigger) cmd_trigger "$@" ;;
    scenario) cmd_scenario ;;
    stop) cmd_stop ;;
    *)
      printf '\033[31merreur :\033[0m commande inconnue « %s »\n\n' "${command}" >&2
      usage >&2
      exit 64 # EX_USAGE
      ;;
  esac
}

main "$@"
