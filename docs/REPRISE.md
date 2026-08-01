# ChronoCast — Document de reprise

Ce document permet de reprendre le développement depuis une fenêtre de contexte vierge, sans aucune analyse préalable ni question à poser. Il décrit l'objectif, ce qui est fait, ce qui reste, et toutes les règles et décisions en vigueur.

**Dernière mise à jour :** 1er août 2026, après fusion de la PR #4 (fin de la Phase 3).

---

## 1. Objectif du projet

ChronoCast est un **compteur subathon Twitch pour OBS** : un compte à rebours affiché sur le stream, démarrant à une valeur configurable (12 h par défaut) et incrémenté automatiquement par les événements Twitch — subs, resubs, gift subs, Prime, bits, et en option raid et follow.

Le produit doit être une **application Windows autonome**, téléchargeable et lançable sans installer Node.js ni aucune dépendance, fonctionnant intégralement en local. La seule communication sortante est celle qui va vers Twitch. Aucun serveur, aucune base de données distante, aucun abonnement.

L'utilisateur final télécharge un `.exe`, le lance, suit un assistant de première configuration, colle une URL dans une Browser Source OBS, et c'est fini.

### Exigences structurantes

- **Le compteur survit à tout** : fermeture, crash, redémarrage du PC. Il repart exactement dans son dernier état.
- **Aucune valeur métier codée en dur** : tout est configurable depuis le panneau d'administration.
- **Aucune faille de sécurité** : l'overlay affiche du contenu choisi par des tiers non fiables (pseudos, messages de viewers).
- **Protection contre les doublons** : Twitch retransmet des événements, et plusieurs flux décrivent le même fait.
- **EventSub WebSocket uniquement**, jamais de webhooks : aucun nom de domaine, aucun port ouvert sur Internet.

---

## 2. Règles de travail — non négociables

Ces règles ont été énoncées explicitement par l'utilisateur. Elles priment sur tout comportement par défaut.

1. **Aucune signature dans les messages de commit.** Pas de `Co-Authored-By`, pas de mention d'outil ou de modèle. « Je ne veux rien voir. »
2. **Toujours du TDD.** Aucune ligne de code de production sans un test écrit d'abord et dont l'échec a été **constaté** dans le conteneur. Seule exemption validée : le HTML et le CSS purement présentationnels, vérifiés visuellement, toute logique étant extraite dans un module testé.
3. **Ne jamais committer sans demande explicite** de l'utilisateur.
4. **Après chaque commit, produire un document Markdown de PR** en français, à la racine, nommé `PR-<branche>.md` (le motif `PR-*.md` est dans `.gitignore`).
5. **Quand l'utilisateur dit « c'est ok » ou signale la fusion**, supprimer le document de PR devenu obsolète.
6. **Toujours vérifier la branche courante avant toute action** : `git branch --show-current` en premier, systématiquement.
7. **Markdown sans word-wrap** dans les documents livrés à l'utilisateur : un paragraphe tient sur une seule ligne, l'éditeur gère l'affichage. Un texte pré-coupé à 80 colonnes se colle mal dans GitHub. Cette règle ne concerne **pas** le code source, dont les commentaires gardent une largeur raisonnable.
8. **Jamais de commit sur `main`.** Une branche typée par fonctionnalité (`chore/`, `feat/`, `fix/`), messages au format Conventional Commits avec un corps expliquant le *pourquoi*. C'est l'utilisateur qui crée et fusionne les PR — ne jamais les ouvrir à sa place.
9. **Aucun binaire installé sur la machine hôte, hormis Docker.** Ni Node, ni npm, ni npx, ni CLI tierce. Tout l'outillage passe par un conteneur, via `./scripts/dc.sh`.

---

## 3. Environnement

- Machine : WSL2 sous Windows, Docker 29.x, Compose v5.x. **Aucun Node installé sur l'hôte.**
- Dépôt : `https://github.com/thedevopser/ChronoCast`, remote `origin` en **SSH** (`git@github.com:thedevopser/ChronoCast.git`), branche par défaut `main`.
- `gh` CLI est authentifié et fonctionnel.
- Répertoire de travail : `/home/thedevopser/projets/applications/ChronoCast`.

**Piège de configuration à connaître.** Le gitignore global de cette machine (`~/.gitignore_global`) exclut `docs/*`. La documentation étant un livrable du projet, le `.gitignore` du dépôt la réintègre explicitement par `!docs/` et `!docs/**`. Sans cette exception, ni ce document ni les neuf documents de la Phase 8 ne seraient versionnés, et ils disparaîtraient au premier clone ailleurs. Ne pas retirer ces deux lignes.

### Commandes

Tout passe par `./scripts/dc.sh`, qui exécute dans un conteneur.

```bash
./scripts/dc.sh install      # npm ci --ignore-scripts
./scripts/dc.sh lint         # ESLint
./scripts/dc.sh typecheck    # tsc --noEmit (node + racine)
./scripts/dc.sh test [motif] # Vitest
./scripts/dc.sh verify       # lint + typecheck + test + audit
./scripts/dc.sh build        # compilation TypeScript + copie des assets web
./scripts/dc.sh build:win    # installeur Windows NSIS via Wine
./scripts/dc.sh shell        # shell interactif
./scripts/dc.sh npm <args>   # commande npm arbitraire
./scripts/dc.sh down         # arrêt et nettoyage
```

---

## 4. Décisions d'architecture actées

Ces décisions ont été validées par l'utilisateur. **Ne pas les rouvrir.**

| Sujet | Décision | Justification |
| --- | --- | --- |
| Cible V1 | **Windows uniquement** (`.exe` NSIS) | Linux et macOS repoussés en V2, et seulement si la V1 est pleinement fonctionnelle |
| Enveloppe | **Electron + electron-builder** | Apporte `safeStorage` (DPAPI), fenêtre OAuth, systray, packaging |
| Persistance | **JSON atomique + JSONL append-only** | Zéro dépendance native, donc packaging trivial. SQLite imposerait un build par couple OS/arch, impossible depuis un conteneur Linux vers Windows |
| Langage | **TypeScript strict**, front vanilla sans framework | |
| Prime | **`channel.chat.notification` activé** | Seul flux exposant `is_prime` |
| Reprise | **Mode gel** | Le temps hors-ligne n'est jamais décompté ; un crash nocturne ne coûte rien au streamer |
| Signature | **Binaire non signé** | Certificat à 300-500 €/an. SmartScreen documenté, SHA-256 publié |
| Release | **Push d'un tag `vX.Y.Z`** | Build + GitHub Release avec l'installeur attaché |
| WebSocket | **Attaché au serveur HTTP par défaut** | Un seul port à configurer ; option `separate` disponible |
| Redirect URI OAuth | **Port fixe 37771**, serveur loopback éphémère | Twitch exige une correspondance exacte, or le port HTTP applicatif est configurable |

### Hors périmètre V1, explicitement

- Aucun build Linux ni macOS, aucun runner macOS en CI.
- Aucune signature de code.
- Aucune mise à jour automatique (`electron-updater`).

---

## 5. Principe directeur de l'architecture

**`src/core/**` n'importe jamais `electron`.** Toutes les dépendances plateforme passent par des ports injectés définis dans `src/core/app/ports.ts` : `PathProvider`, `SecretStore`, `Clock`, `BrowserOpener`. Une règle ESLint interdit mécaniquement l'import d'`electron` depuis le noyau.

Conséquences directes, et raison d'être de tout le reste :

- l'intégralité de la logique se vérifie dans un Node nu, sans Chromium ni serveur graphique — indispensable puisque la toolchain est en conteneur Linux alors que la cible est Windows ;
- un point d'entrée `src/headless/index.ts` (à écrire, Phase 4) lancera l'application complète sans Electron, rendant la vérification bout en bout possible en conteneur ;
- `src/main/**` (à écrire, Phase 6) sera une coquille Electron mince : cycle de vie, fenêtre, tray, et implémentations concrètes des ports.

De la même façon, `Clock` expose **deux** horloges : `now()` pour les horodatages, qui peut reculer lors d'un changement d'heure, et `monotonicMs()` pour mesurer des durées, qui ne recule jamais. C'est `monotonicMs()` qui fait décompter le compteur, faute de quoi le passage à l'heure d'hiver offrirait une heure de subathon.

---

## 6. État actuel du dépôt

**Branche courante : `main`**, à jour avec `origin/main`. Aucune branche de travail en cours, aucun document de PR en attente. Les quatre PR des Phases 0 à 3 sont fusionnées en squash.

```
6da9bfd Module Twitch : OAuth, Helix, EventSub, conversion et déduplication (#4)   <- main
c7d5c64 Métier du compteur : réducteurs purs, barème et service (#3)
b93615c Fondations du noyau : journalisation, persistance, configuration (#2)
ce9b342 chore(build): mettre en place le socle d'outillage conteneurisé (#1)
18969d2 chore: initialiser le dépôt ChronoCast
```

**394 tests, 18 fichiers. Lint, typecheck et `npm audit --audit-level=high` sans erreur.**

### Première action à la reprise

```bash
git branch --show-current    # doit afficher main
git pull --ff-only origin main
./scripts/dc.sh verify       # doit être intégralement vert
git checkout -b feat/serveurs-locaux
```

La Phase 4 peut alors commencer, en TDD, en suivant la section 8.

---

## 7. Ce qui est fait — Phases 0 à 3

### Phase 0 — Socle d'outillage (PR #1, fusionnée)

Trois images Docker : `dev` (`node:22-bookworm-slim`, ne télécharge pas Electron), `build` (`electronuserland/builder:wine`, produit le `.exe`), `twitch-cli` (serveur EventSub factice, version figée 1.1.24 avec vérification de somme de contrôle).

`node_modules` est un **volume nommé** et non un bind-mount : performances d'E/S sur WSL2, et des artefacts Linux n'ont rien à faire dans un projet ciblant Windows. Le répertoire est créé dans l'image avec la bonne propriété, sans quoi Docker initialise le volume en `root` et l'installation échoue.

Configuration TypeScript éclatée en trois cibles pour rendre deux décisions mécaniques : `tsconfig.node.json` n'expose pas la bibliothèque DOM (interdit une API navigateur dans le backend), `tsconfig.web.json` retire les typages Node (interdit `fs` ou `path` dans le front). **`tsconfig.web.json` est temporairement hors de `npm run typecheck`** car `src/web/` est vide et TypeScript échoue sur un projet sans fichier (TS18003) — il est exécutable via `npm run typecheck:web` et **doit être réintégré en Phase 5**.

ESLint bloque `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, les URL `javascript:`, l'import d'`electron` depuis `src/core`, l'import d'API serveur depuis `src/web`, les promesses non attendues et le code mort.

Vitest est en **v4** et non v2 : la chaîne `vitest 2 → vite → esbuild` portait cinq vulnérabilités connues dont une critique.

### Phase 1 — Fondations du noyau (PR #2, fusionnée, 137 tests)

| Fichier | Rôle |
| --- | --- |
| `core/logging/redaction.ts` | Masquage des secrets, par nom de clé **et** par valeur enregistrée. Les clés de diagnostic (`code`, `statusCode`) sont épargnées. Gère cycles, profondeur, tableaux longs |
| `core/logging/logger.ts` | Niveaux, portées imbriquées, contexte différé (non évalué si filtré), puits défaillant sans impact sur l'appelant |
| `core/logging/sinks/` | `ring-buffer-sink` (admin, réponse immédiate), `jsonl-sink` (disque, écritures différées + `flush()`), `console-sink` (démarrage) |
| `core/storage/atomic-json-store.ts` | Écriture temporaire → `fsync` → `rename`. Sauvegarde `.bak` par copie. Lecture avec repli en cascade et mise en quarantaine. **Ne lève jamais en lecture** |
| `core/storage/jsonl-store.ts` | Journal append-only, rotation quotidienne, purge par rétention. Ligne tronquée ignorée |
| `core/app/ports.ts` | Contrats `PathProvider`, `SecretStore`, `Clock`, `BrowserOpener`. Types purs, rien à tester |
| `core/app/event-bus.ts` | Bus typé. Abonné défaillant isolé. Instantané à l'émission, désabonnement effectif immédiatement |
| `core/config/schema.ts` | Schéma Zod complet, ~70 réglages, tous avec valeur par défaut |
| `core/config/defaults.ts` | `DEFAULT_CONFIG` **dérivé du schéma** (`configSchema.parse({})`), gelé en profondeur |
| `core/config/config-service.ts` | Chargement, fusion partielle, validation, import/export, migration de version |

Décisions à connaître : le schéma est en mode **`strip`** et non `strict` — une clé inconnue est écartée silencieusement, car rejeter un fichier contenant un réglage supprimé depuis empêcherait l'utilisateur de démarrer après une mise à jour. La protection contre la pollution de prototype est assurée en amont par `sanitize()`, qui retire `__proto__`, `constructor` et `prototype` **avant** la validation.

`ConfigService.update()` écrit sur le disque **avant** de mettre à jour l'état en mémoire : si la persistance échoue, l'utilisateur doit voir la valeur réellement enregistrée.

`schemaVersion` est validé en `nonnegative()` et non `positive()` : la contrainte initiale rejetait `0` et faisait repartir de zéro toute configuration d'une version antérieure, précisément le cas où l'on cherche à la récupérer.

### Phase 2 — Métier du compteur (PR #3, fusionnée, 90 tests, 227 au total)

| Fichier | Rôle |
| --- | --- |
| `core/counter/counter-state.ts` | Réducteurs purs : `createInitialState`, `applyTick`, `applyAdd`, `applyRemove`, `applyPause`, `applyResume`, `applyReset`, `applySetInitial` |
| `core/events/domain-event.ts` | Vocabulaire normalisé. Rien de spécifique à Twitch ne franchit cette frontière |
| `core/counter/reward-engine.ts` | Barème pur : tous tiers, Prime, gifts, bits linéaire et par paliers, raid, follow |
| `core/counter/counter-service.ts` | Orchestration : horloge, cadenceur injecté, persistance, diffusion |
| `core/app/app-events.ts` | Catalogue typé du bus |

Conventions à connaître :

- **Les réducteurs renvoient l'état identique par référence** quand une action n'a aucun effet. Le service s'en sert pour éviter une écriture disque et une diffusion WebSocket inutiles.
- **Créditer du temps relance un compteur achevé** : un gift sub arrivant après la fin rouvre le subathon, c'est ce que le spectateur croit acheter. Mais un compteur jamais démarré n'est pas mis en route pour autant.
- **Changer la valeur de départ en plein subathon ne touche pas au temps restant** : le répercuter effacerait le temps gagné par les spectateurs.
- **Deux régimes de persistance** : mutation (événement, action manuelle) → écriture immédiate avant diffusion ; érosion naturelle du tick → écriture périodique (5 s par défaut). L'atteinte du plancher est écrite tout de suite.
- **Un échec disque n'arrête pas le subathon** : l'état reste appliqué en mémoire, l'incident est journalisé et publié sur `counter:persist-failed`. C'est l'inverse du service de configuration, et c'est délibéré.
- Le magasin est typé `AtomicJsonStore<CounterState | null>`, où `null` signifie « installation neuve ».

### Phase 3 — Module Twitch (PR #4, fusionnée, 167 tests, 394 au total)

| Fichier | Rôle |
| --- | --- |
| `core/dedup/dedup-cache.ts` | Cache TTL + éviction par ancienneté, sérialisable et rechargeable |
| `core/twitch/event-mapper.ts` | Charges utiles EventSub → vocabulaire métier, plus `semanticKey()` |
| `core/twitch/token-store.ts` | Secrets chiffrés via `SecretStore` + déclaration au rédacteur |
| `core/twitch/oauth-service.ts` | Flux code d'autorisation, renouvellement proactif, validation, révocation |
| `core/twitch/helix-client.ts` | Souscriptions EventSub, reprise différenciée par type d'échec |
| `core/twitch/subscription-plan.ts` | Plan déclaratif + calcul des portées OAuth |
| `core/twitch/eventsub-client.ts` | Machine à états WebSocket |
| `tests/fixtures/eventsub-payloads.ts` | Charges utiles fidèles à la documentation Twitch |

**Les trois pièges du protocole, traités et documentés** — ce sont eux qui justifient l'essentiel du code :

1. Un don d'abonnements est annoncé **deux fois** : `channel.subscription.gift` au donateur, **plus** un `channel.subscribe` avec `is_gift: true` par bénéficiaire. Seuls les premiers sont retenus.
2. Un don groupé est annoncé **deux fois** aussi : `community_sub_gift` porte le total, puis un `sub_gift` par bénéficiaire avec `community_gift_id`. Ces derniers sont écartés. Sans cette règle, un don de 10 subs créditerait 20 fois.
3. **Prime est indistinguable de Tier 1** sur `channel.subscribe` (`tier: "1000"` dans les deux cas). `channel.chat.notification` est le seul flux exposant `is_prime` : il est la source primaire. La `semanticKey()` permet la déduplication croisée entre les deux sources — elle omet la provenance et assimile Prime à Tier 1, sans quoi elle laisserait passer le doublon qu'elle doit attraper.

**Autres points à connaître :**

- La garde de mutualisation des renouvellements OAuth est **strictement synchrone**. Une version antérieure la posait après un `await` : trois appels concurrents la franchissaient tous et déclenchaient trois renouvellements, dont chacun invalidait le précédent.
- Le client EventSub gère la **coupure silencieuse** (connexion ouverte mais muette, sans erreur ni fermeture) via un chien de garde sur le keepalive, réarmé à chaque message quel qu'en soit le type.
- Lors d'une **migration de session**, l'ancienne connexion n'est fermée qu'après l'accueil de la nouvelle, et les souscriptions ne sont **pas** recréées (Twitch les transfère). Une **vraie reconnexion**, elle, les recrée.
- `channel.chat.notification` est marquée **facultative** dans le plan : si les portées de chat n'ont pas été accordées, le subathon continue avec `channel.subscribe` en repli, Prime étant alors traité comme Tier 1.
- `channel.follow` est en **version 2**, la v1 étant dépréciée.
- Tous les tests injectent transport, minuteurs, `fetch` et horloge : **aucun accès réseau, aucune attente réelle**.

---

## 8. Ce qui reste à faire — Phases 4 à 8

### Phase 4 — Serveurs locaux et point d'entrée headless — **prochaine étape**

Branche suggérée : `feat/serveurs-locaux`.

**`core/server/http-server.ts`** — `node:http`, sans framework. Bind strict `127.0.0.1`. Sert `/overlay`, `/admin`, `/setup`, les assets et l'API JSON. Détection `EADDRINUSE` avec essai des `portFallbackAttempts` ports suivants.

**`core/server/security/`** — trois gardes, chacune couverte par des tests dans `tests/security/` :
- `host-guard.ts` : rejet si l'en-tête `Host` n'est pas loopback. Sans cela, un site web visité par le streamer pourrait piloter son compteur (DNS rebinding).
- `csrf.ts` : toute mutation exige l'en-tête `X-ChronoCast-Token`, jeton généré au démarrage et injecté dans la page admin. L'overlay reste en lecture seule sans jeton, pour que OBS charge l'URL telle quelle. Vérification de l'`Origin` sur les connexions WS admin.
- `headers.ts` : CSP stricte **sans `unsafe-inline`**, `X-Content-Type-Options`, `Referrer-Policy`. Aucun en-tête CORS permissif.

**`core/server/static-handler.ts`** — résolution puis vérification que le chemin canonique reste sous la racine, liste blanche d'extensions, aucun listing de répertoire.

**`core/server/ws-hub.ts`** — WebSocket sur `/ws`, mode `shared` (même port que HTTP) par défaut. Diffuse `hello`, `state`, `counter`, `twitch:status`, `event`, `log`, `config`, `error`. Heartbeat ping/pong 30 s, sockets morts terminés, messages entrants validés par Zod, taille de message plafonnée.

**`core/server/routes/`** — API : état, configuration (GET/PATCH/import/export), actions compteur (pause, reprise, ajout, retrait, reset, valeur de départ), Twitch (statut, connexion, révocation, souscriptions), historique, logs, test d'overlay.

**`core/app/application.ts`** — composition root. Câble tout : magasins, logger et ses puits, configuration, compteur, chaîne Twitch, serveurs. C'est ici que le pipeline complet est assemblé : `EventSubClient.onNotification` → cache de déduplication sur `message_id` → `mapNotification` → cache sémantique via `semanticKey` → `CounterService.applyEvent` → historique JSONL → diffusion WebSocket.

**`core/history/event-history-service.ts`** — historique des événements sur `JsonlStore`, avec purge.

**`headless/index.ts`, `headless/fs-path-provider.ts`, `headless/aes-secret-store.ts`** — point d'entrée sans Electron. Le magasin de secrets de repli utilise AES-256-GCM avec clé dérivée par scrypt, et **journalise un avertissement explicite** indiquant que ce n'est pas de niveau coffre-fort.

**Tests d'intégration** (`tests/integration/`) : application headless démarrée en conteneur, injection d'une notification EventSub simulée, assertion sur l'incrément du compteur, l'écriture immédiate de l'état, l'entrée d'historique et le message diffusé au client WS. Rejeu du **même `message_id`** → aucun second incrément. Arrêt puis redémarrage → état restauré à l'identique.

### Phase 5 — Interfaces web

Branche suggérée : `feat/interfaces-web`.

**Première action : réintégrer `tsconfig.web.json` dans `npm run typecheck`.** C'est tracé et ne doit pas être oublié.

**`web/shared/`** — `protocol.ts` (contrat WS partagé), `ws-client.ts` (reconnexion avec backoff), `time-format.ts`, `safe-dom.ts` (**seul point autorisé à toucher le DOM**, via `textContent`).

**`web/overlay/`** — fond transparent, **aucun asset distant** (polices embarquées : l'application doit fonctionner hors ligne, et une CDN violerait la CSP). Le serveur ne diffuse l'état qu'**une fois par seconde** ; l'overlay interpole localement en `requestAnimationFrame`. **Point critique OBS** : les Browser Sources ne sont pas rechargées automatiquement, donc l'overlay continue à décompter en local pendant une coupure et se resynchronise seul au retour. Personnalisation par variables CSS injectées depuis la configuration. Le pseudo est inséré **via `textContent`** — c'est du contenu hostile par défaut.

**`web/admin/`** — vues : tableau de bord, barème, apparence (aperçu live en iframe), Twitch, historique, logs, paramètres, import/export.

**Assistant de première configuration** — six étapes : explication et lien vers la console développeur Twitch avec la redirect URI exacte à copier, saisie Client ID et Secret, bouton de connexion, chaîne détectée automatiquement avec vérification des portées, valeur initiale et barème, URL de l'overlay à coller dans OBS. Reprise possible à l'étape interrompue.

**Serveur loopback OAuth** — port fixe `37771`, actif uniquement pendant le flux, usage unique, expiration 5 min, `state` de 32 octets vérifié en comparaison à temps constant.

### Phase 6 — Coquille Electron

Branche suggérée : `feat/coquille-electron`.

`main/main.ts` (instance unique, cycle de vie, lancement au démarrage), `main/windows.ts`, `main/tray.ts`, `main/electron-path-provider.ts` (`%APPDATA%\ChronoCast`), `main/safe-storage-secret-store.ts` (`safeStorage` après vérification d'`isEncryptionAvailable()`).

**Durcissement obligatoire** : `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, aucun preload exposant Node. `setWindowOpenHandler` et `will-navigate` bloquent toute navigation hors liste blanche (`id.twitch.tv`, `twitch.tv`) et renvoient vers le navigateur système. DevTools désactivés en production. `asar` activé.

### Phase 7 — Packaging et CI

Branche suggérée : `chore/packaging-ci`.

`electron-builder.yml` (cible NSIS Windows uniquement), `.github/workflows/ci.yml` (lint, typecheck, tests, `npm audit` bloquant), `.github/workflows/release.yml` (tag `vX.Y.Z` → contrôle de cohérence avec `package.json` → build `.exe` → changelog depuis les commits → GitHub Release avec l'installeur et son SHA-256).

Le service `build-win` de `docker/compose.yml` existe déjà mais **n'a jamais été exécuté** : il faudra le vérifier.

### Phase 8 — Documentation

Branche suggérée : `docs/documentation-complete`.

Neuf documents dans `docs/` : `ARCHITECTURE.md` (avec diagrammes Mermaid des flux), `DEVELOPER.md`, `USER-GUIDE.md` (avec la procédure SmartScreen), `BUILD.md`, `RELEASE.md`, `SECURITY.md`, `TESTING-TWITCH-CLI.md`, `CRASH-RECOVERY.md`, `OVERLAY-CUSTOMIZATION.md`.

Le `README.md` référence déjà ces documents : les liens sont actuellement morts.

Prévoir aussi `scripts/twitch-mock.sh`, qui pilote le conteneur `twitch-cli` : `twitch event websocket start-server`, l'application pointée dessus via `twitch.eventsubUrl`, puis `twitch event trigger subscribe|subscription-message|subscription-gift|cheer --transport=websocket`.

---

## 9. Modèle de menace — à respecter dans les phases restantes

L'application écoute sur loopback, manipule des secrets OAuth, et **affiche du contenu contrôlé par des tiers non fiables**.

**Contenu hostile venu de Twitch.** N'importe quel viewer peut choisir un pseudo ou un message de cheer contenant du HTML, et l'overlay tourne dans une Browser Source OBS. `textContent` exclusivement, `innerHTML` banni par ESLint, CSP stricte sans `unsafe-inline` (scripts et styles servis en fichiers, jamais en ligne), longueurs tronquées. Échappement des retours à la ligne et séquences ANSI dans les logs. Tout JSON externe passe par Zod, les clés `__proto__` étant retirées avant validation. Tailles de message plafonnées.

**Secrets.** Chiffrés au repos, jamais renvoyés par l'API d'administration (champs en écriture seule, lecture masquée), jamais diffusés sur le WebSocket, systématiquement rédigés dans les logs.

**Serveur local.** Bind `127.0.0.1` strict, garde anti-DNS-rebinding sur `Host`, jeton CSRF sur toute mutation, protection contre la traversée de chemin, aucun CORS permissif.

**Chaîne d'approvisionnement.** Dépendances de production minimales (`electron`, `ws`, `zod`). `npm ci --ignore-scripts`, `npm audit --audit-level=high` bloquant en CI.

Les tests de sécurité doivent vivre dans `tests/security/` : injection XSS via pseudo, `Host` non-loopback rejeté, mutation sans jeton CSRF refusée, traversée `../../` bloquée, `state` OAuth invalide rejeté, import de configuration malveillant refusé, secrets absents des logs.

---

## 10. Vérification finale attendue à la fin du projet

1. `./scripts/dc.sh verify` intégralement vert.
2. Tests d'intégration : notification simulée → incrément, persistance, historique, diffusion. Doublon de `message_id` → aucun second incrément. Redémarrage → état restauré.
3. Twitch CLI : `subscribe`, `subscription-message`, `subscription-gift`, `cheer` validés contre le serveur factice.
4. Reprise après crash : `kill -9` pendant un décompte, redémarrage, temps restant conservé (perte ≤ 5 s, toujours en faveur du streamer), aucun fichier corrompu.
5. `./scripts/dc.sh build:win` produit l'installeur, taille et SHA-256 vérifiés.
6. **Validation manuelle sur poste Windows — revient à l'utilisateur** : installation, assistant, URL overlay dans OBS, événement de test, redémarrage du PC pour confirmer la restauration.

---

## 11. Plan d'origine

Le plan validé initialement se trouve dans `/home/thedevopser/.claude/plans/tu-es-un-architecte-swirling-rabbit.md`. Ce document de reprise le remplace pour tout ce qui concerne l'état d'avancement, mais le plan reste la référence pour les intentions de départ.
