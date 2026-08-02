# ChronoCast

Compteur subathon Twitch pour OBS : un compte à rebours affiché sur le stream, qui
s'incrémente automatiquement à chaque sub, resub, gift sub, sub Prime ou don de bits.

Tout fonctionne en local. Aucun serveur, aucune base de données distante, aucun
abonnement : la seule communication sortante est celle qui va vers Twitch.

## En deux mots

- **Un overlay** à ajouter dans OBS comme simple Browser Source, fond transparent.
- **Un panneau d'administration** local pour tout piloter : barème, apparence,
  pause, ajout ou retrait de temps, historique, logs.
- **Une connexion Twitch EventSub** en WebSocket, sans nom de domaine ni port
  ouvert sur Internet.
- **Un état persistant** : le compteur survit à une fermeture, à un crash et à un
  redémarrage du PC, et repart exactement là où il s'était arrêté.

## Installation

Téléchargez le dernier installeur `.exe` depuis la page des
[releases](https://github.com/TheDevOpser/ChronoCast/releases), lancez-le, puis
suivez l'assistant de première configuration.

Aucune dépendance à installer : Node.js, le serveur HTTP et le serveur WebSocket
sont embarqués dans l'application.

> L'exécutable n'est pas signé numériquement (un certificat coûte plusieurs
> centaines d'euros par an). Windows SmartScreen affichera donc « Éditeur
> inconnu » au premier lancement : cliquez sur **Informations complémentaires**
> puis **Exécuter quand même**. Chaque release publie l'empreinte SHA-256 de
> l'installeur pour vérifier son intégrité.

Plateforme prise en charge en V1 : **Windows**. Linux et macOS sont envisagés
pour une version ultérieure.

## Documentation

| Document | Contenu |
| --- | --- |
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md) | Guide utilisateur : installation, connexion à Twitch, ajout dans OBS |
| [docs/OVERLAY-CUSTOMIZATION.md](docs/OVERLAY-CUSTOMIZATION.md) | Personnalisation de l'overlay |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture, flux de données, choix techniques |
| [docs/DEVELOPER.md](docs/DEVELOPER.md) | Guide développeur |
| [docs/BUILD.md](docs/BUILD.md) | Procédure de build |
| [docs/RELEASE.md](docs/RELEASE.md) | Procédure de publication |
| [docs/TESTING-TWITCH-CLI.md](docs/TESTING-TWITCH-CLI.md) | Tests avec la Twitch CLI |
| [docs/CRASH-RECOVERY.md](docs/CRASH-RECOVERY.md) | Récupération après crash |
| [docs/SECURITY.md](docs/SECURITY.md) | Modèle de menace et contrôles de sécurité |

## Développement

Le projet se développe **entièrement en conteneur** : aucun binaire Node n'a
besoin d'être installé sur la machine.

```bash
./scripts/dc.sh install     # installe les dépendances
./scripts/dc.sh test        # suite de tests
./scripts/dc.sh verify      # lint + typecheck + tests + audit
./scripts/dc.sh build       # compilation TypeScript
./scripts/dc.sh help        # toutes les commandes
```

L'installeur Windows, lui, n'est pas construit en local : il l'est par le
workflow `Release`, nativement sur un runner Windows. Voir
[docs/BUILD.md](docs/BUILD.md).

Le développement suit un TDD strict : aucune ligne de code de production n'est
écrite sans un test qui a d'abord échoué. Voir [docs/DEVELOPER.md](docs/DEVELOPER.md).

## Licence

MIT
