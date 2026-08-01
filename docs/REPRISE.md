# ChronoCast — Document de reprise

Ce document permet de reprendre le développement depuis une fenêtre de contexte vierge, sans aucune analyse préalable ni question à poser. Il décrit l'objectif, ce qui est fait, ce qui reste, et toutes les règles et décisions en vigueur.

**Dernière mise à jour :** 1er août 2026. Phases 0 à 4 terminées. **Phase 5 : PR A fusionnée (#7), PR B écrite et verte sur `feat/setup-oauth`, en attente de relecture.** Reste la **PR C** (panneau d'administration).

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
5. **Quand l'utilisateur dit « c'est ok » ou signale la fusion, nettoyer sans qu'il ait à le demander.** Cela couvre : supprimer le document de PR devenu obsolète, supprimer la branche locale de travail (`git branch -D <branche>` — après une fusion en squash, Git ne la considère pas comme fusionnée), supprimer les artefacts de build (`dist/`, fichiers temporaires laissés à la racine), et mettre à jour ce document. Ne pas demander confirmation pour ce nettoyage : le demander, c'est déjà ne pas l'avoir fait.
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
- le point d'entrée `src/headless/index.ts` (Phase 4) lance l'application complète sans Electron, ce qui rend la vérification bout en bout possible en conteneur ;
- `src/main/**` (à écrire, Phase 6) sera une coquille Electron mince : cycle de vie, fenêtre, tray, et implémentations concrètes des ports.

De la même façon, `Clock` expose **deux** horloges : `now()` pour les horodatages, qui peut reculer lors d'un changement d'heure, et `monotonicMs()` pour mesurer des durées, qui ne recule jamais. C'est `monotonicMs()` qui fait décompter le compteur, faute de quoi le passage à l'heure d'hiver offrirait une heure de subathon.

---

## 6. État actuel du dépôt

**Branche courante : `feat/setup-oauth`**, partie de `main` à `67d9219`. La PR B y est écrite et verte, **non commitée** — l'utilisateur seul décide du moment. Les sept PR précédentes sont fusionnées en squash.

```
67d9219 feat(web): fondations web et overlay OBS (#7)                 <- main
eb02663 Phase 4 — Serveurs locaux et point d'entrée headless (#6)
28cf0c4 docs: ajouter le document de reprise et rendre docs/ versionnable (#5)
6da9bfd Module Twitch : OAuth, Helix, EventSub, conversion et déduplication (#4)
c7d5c64 Métier du compteur : réducteurs purs, barème et service (#3)
b93615c Fondations du noyau : journalisation, persistance, configuration (#2)
ce9b342 chore(build): mettre en place le socle d'outillage conteneurisé (#1)
18969d2 chore: initialiser le dépôt ChronoCast
```

**1 025 tests, 47 fichiers. Lint, les trois typechecks et `npm audit --audit-level=high` sans erreur.**

**Seule modification en attente : ce fichier.** ### Première action à la reprise

```bash
git branch --show-current    # doit afficher feat/setup-oauth
./scripts/dc.sh verify       # doit être intégralement vert (1 025 tests)
```

Puis, selon ce que décide l'utilisateur : committer la PR B, ou enchaîner sur la PR C (`feat/admin-web`) en suivant la section 8.

---

## 7. Ce qui est fait — Phases 0 à 4

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

### Phase 4 — Serveurs locaux et point d'entrée headless (PR #6, fusionnée, 403 tests, 797 au total)

| Fichier | Rôle |
| --- | --- |
| `core/server/http-types.ts` | Requête et réponse normalisées : la frontière entre l'adaptateur `node:http` et tout le reste du serveur |
| `core/server/security/host-guard.ts` | Refus de tout `Host` non loopback, correspondance exacte et sans tolérance |
| `core/server/security/csrf.ts` | Jeton de 32 octets, comparaison à temps constant, contrôle d'`Origin` pour le WebSocket |
| `core/server/security/headers.ts` | CSP stricte sans `unsafe-inline`, `nosniff`, `no-referrer`, aucun CORS |
| `core/server/static-handler.ts` | Résolution puis contrôle du chemin canonique, canonisation des liens symboliques, liste blanche d'extensions |
| `core/server/routes/pages.ts` | `/overlay`, `/admin`, `/setup` ; substitution du jeton dans les deux dernières seulement |
| `core/server/router.ts` | Aiguillage pur : gardes, puis API, pages, statique. En-têtes de sécurité en sortie |
| `core/server/http-server.ts` | Adaptateur `node:http` : bind loopback, plafond de corps, repli de port |
| `core/server/protocol.ts` | Contrat WebSocket partagé. La Phase 5 le ré-exportera depuis `web/shared/` |
| `core/server/ws-hub.ts` | Diffusion, lissage du décompte, ping/pong, filtrage par canal |
| `core/server/ws-adapter.ts` | Seul fichier important `ws`. Garde d'`Host` sur la poignée de main |
| `core/server/routes/api.ts` | Dix-huit routes : état, configuration, compteur, Twitch, historique, journaux, test d'overlay |
| `core/history/event-history-service.ts` | Historique JSONL, y compris des événements non crédités |
| `core/app/system-clock.ts`, `system-ticker.ts` | Implémentations réelles de `Clock` et `Ticker`, partagées avec la future coquille Electron |
| `core/app/application.ts` | Composition root : câble le pipeline complet |
| `core/twitch/ws-socket-adapter.ts` | Fabrique de sockets EventSub sur `ws` |
| `headless/fs-path-provider.ts`, `aes-secret-store.ts`, `index.ts` | Ports concrets et point d'entrée sans Electron |

**Décisions prises pendant cette phase, à ne pas rouvrir :**

- **Le routage est une fonction pure.** `HttpRequest` → `HttpResponse`. L'intégralité des routes et des trois gardes se teste sans ouvrir un socket ; `http-server.ts` n'est qu'un adaptateur.
- **Le jeton CSRF est injecté dans le HTML**, par substitution du marqueur `__CHRONOCAST_CSRF__` dans une balise `meta`, jamais exposé par une route. Une page tierce ne peut donc ni le lire ni le deviner. L'overlay ne le reçoit pas.
- **Le WebSocket est en lecture seule.** Il diffuse, il ne commande pas ; seuls `ping` et `subscribe` sont acceptés en entrée. Toute mutation passe par l'API HTTP avec jeton.
- **La garde d'`Host` est posée deux fois** : dans le routeur et dans l'adaptateur WebSocket. Une poignée de main `upgrade` ne traverse pas le routeur.
- **Le secret client Twitch est frère de `config` dans le corps du `PATCH`, jamais son enfant.** Il va dans le magasin chiffré, est déclaré au rédacteur avant d'être écrit, et ne ressort ni par `GET`, ni par l'export, ni par les journaux. L'exclusion est structurelle, pas une exception à ne pas oublier.
- **Une panne Twitch devient un `502`**, pas un `500` : le streamer doit savoir de quel côté chercher.
- **La garde CSRF passe avant la résolution de route.** Une mutation non authentifiée sur une route inexistante répond `403` et non `404` : sinon la carte de l'API se dessine à qui la demande.
- **Le décompte n'est diffusé qu'une fois par seconde** (`server.websocket.stateBroadcastIntervalMs`), l'overlay interpolant localement. Les mutations, elles, partent immédiatement.
- **Le compteur et la configuration sont écrits dès le démarrage.** Le répertoire de données décrit alors l'application, une migration de schéma se matérialise sur le disque, et un répertoire non inscriptible se signale au démarrage plutôt qu'en pleine diffusion.
- **Le magasin de secrets headless est honnêtement dégradé** : AES-256-GCM, clé dérivée par scrypt depuis `CHRONOCAST_SECRET_PASSPHRASE` ou depuis `secret.key` (mode `0600`). `isEncryptionAvailable()` renvoie **faux** et un avertissement explicite est journalisé. La vraie protection viendra de `safeStorage` en Phase 6.

**Quatre réglages ont été ajoutés au schéma** : `server.maxBodyBytes`, `server.websocket.stateBroadcastIntervalMs`, `server.websocket.maxMessageBytes`, et rien d'autre — le reste existait déjà.

**Tests d'intégration** (`tests/integration/application.test.ts`, 24 scénarios) : l'application entière démarre sur un répertoire temporaire, reçoit de vraies charges utiles EventSub, et l'on observe le crédit, l'écriture disque immédiate, l'entrée d'historique et la diffusion à un vrai client WebSocket. Le rejeu du même `message_id`, le don annoncé deux fois et le Prime vu par deux flux ne créditent qu'une fois. Après arrêt et redémarrage, le temps restant est identique et le temps hors ligne n'est pas décompté.

---

## 8. Ce qui reste à faire — Phases 5 à 8

### Phase 5 — Interfaces web — **en cours**

Découpée en trois branches successives (voir « Décisions actées » plus bas) :

| PR | Branche | État |
| --- | --- | --- |
| A | `feat/overlay-web` | **Fusionnée (#7)** — dette `tsconfig.web.json` payée, `web/shared/` complet, overlay complet |
| B | `feat/setup-oauth` | **Écrite, en attente de fusion** — serveur loopback OAuth, extension d'`Application`, assistant de première configuration |
| C | `feat/admin-web` | **Prochaine étape** — panneau d'administration et ses vues |

`web/shared/` et `web/overlay/` sont livrés : voir le détail de la PR A plus bas. **Les PR B et C consomment `web/shared/` tel quel** — `protocol.ts`, `ws-client.ts`, `safe-dom.ts`, `time-format.ts`, `countdown.ts` — et n'ont aucune raison d'en réécrire une partie.

**`web/admin/`** (PR C) — vues : tableau de bord, barème, apparence (aperçu live en iframe), Twitch, historique, logs, paramètres, import/export.

Les pages `admin.html` et `setup.html` doivent contenir `<meta name="chronocast-csrf" content="__CHRONOCAST_CSRF__">` : le serveur y substitue le jeton au moment de servir la page. L'overlay ne doit pas porter ce marqueur.

**Assistant de première configuration** — six étapes : explication et lien vers la console développeur Twitch avec la redirect URI exacte à copier, saisie Client ID et Secret, bouton de connexion, chaîne détectée automatiquement avec vérification des portées, valeur initiale et barème, URL de l'overlay à coller dans OBS. Reprise possible à l'étape interrompue.

**Serveur loopback OAuth et assistant** — livrés par la PR B, détaillée plus bas.

#### Décisions actées pour la Phase 5 — ne pas les rouvrir

Ces quatre points ont été arbitrés avec l'utilisateur au terme d'une session de conception. Ils ont le même statut que les décisions de la section 4.

- **happy-dom est en devDependency** (fait en PR A), activé **uniquement** pour `tests/unit/web/**` et les tests `tests/security/xss-*.test.ts`, via `test.projects` de Vitest 4 ; tout le reste garde `environment: 'node'`. Motif : la section 9 exige un test d'injection XSS par pseudo, et un faux `document` écrit à la main ne prouve rien sur la non-interprétation du HTML — il vérifie une troncature, pas une absence d'exécution. La conception ne change pas pour autant : la logique reste extraite en modules purs, happy-dom sert à prouver ce que l'injection de dépendances ne peut pas prouver, pas à dispenser de concevoir. **Les PR B et C écrivent leurs tests DOM dans ces mêmes emplacements** — ailleurs, ils tourneraient sans DOM et échoueraient sans raison apparente.
- **Trois PR successives**, et non une PR par phase comme jusqu'ici. **PR A** (`feat/overlay-web`) : réintégration de `tsconfig.web.json` dans `npm run typecheck`, `web/shared/` complet, overlay complet. **PR B** (`feat/setup-oauth`) : serveur loopback OAuth, extension de l'interface `Application`, assistant de première configuration. **PR C** (`feat/admin-web`) : panneau d'administration et ses vues. Motif : l'overlay est le livrable de plus grande valeur et doit être vérifiable en premier ; une PR unique dépasserait très largement ce qui se relit.
- **Open Props sera vendoré** en fichier unique dans `src/web/shared/`, non modifié, avec un en-tête portant la version, la licence MIT et le SHA-256. **Non fait en PR A, délibérément** : l'overlay n'en a aucun usage — fond transparent, tout piloté par les variables `--cc-*` venues de la configuration — et livrer un fichier que personne n'utilise n'a pas de sens. Il arrive avec la PR C, qui en a l'emploi. Le reste de la décision tient — la même discipline que le twitch-cli figé de la Phase 0. Récupération reproductible par `npm pack open-props@<version>` dans le conteneur puis extraction du `.css` de l'archive, **pas de `curl`**. Ce n'est que des variables CSS : aucune classe, aucun composant, aucun JS. Par-dessus viennent nos propres tokens sémantiques (`src/web/shared/theme.css`) et nos propres classes. `scripts/copy-web-assets.mjs` copie déjà les `.css` vers `dist/public` : il n'y a aucune plomberie à ajouter, aucune dépendance npm, aucune étape de build, aucune surface d'audit. Direction artistique : thème sombre, sobre et dense, accent Twitch `#9146FF`, navigation latérale, aucune animation superflue.
- **Tailwind a été examiné et écarté** — noté ici pour que le débat ne soit pas rouvert. La CSP ne l'interdit pas : utilisé normalement, c'est un outil de build qui émet un `.css` statique servi depuis `'self'`, parfaitement conforme ; seul le build CDN navigateur (`cdn.tailwindcss.com`), qui compile en JIT dans la page, tomberait sous `script-src 'self'`. Il est écarté pour deux autres raisons : l'arbre transitif et les binaires natifs de la v4 élargissent la surface d'un `npm audit --audit-level=high` qui est bloquant en CI et garde un droit de veto sur chaque PR — c'est exactement la logique qui a fait rejeter Vitest 2 en Phase 0 — et la compatibilité de ces binaires avec `npm ci --ignore-scripts` reste à vérifier. Le volume ne le justifie pas non plus : trois pages, une dizaine de vues, de l'ordre de 700 lignes de CSS.

#### Contraintes découvertes dans le code — ne pas les ré-explorer

Ces faits ont été vérifiés dans le dépôt. Les retrouver coûterait une exploration complète.

- **`web/shared/protocol.ts` ne peut rien ré-exporter du noyau, pas même un type.** Vérifié à l'exécution en Phase 5 : `tsconfig.web.json` fixe `rootDir` à `src/web`, et TypeScript refuse tout fichier du programme situé hors de cette racine (TS6059), y compris atteint par un `import type` pourtant effacé à la compilation. Retirer `rootDir` ferait émettre le noyau compilé dans `dist/public`, servi au navigateur : exclu. ESLint va dans le même sens pour les *valeurs* (`allowTypeImports: true` n'autorise que les `import type`). **Le contrat est donc redéclaré en entier côté web**, et tenu par `tests/unit/web/shared/protocol.test.ts`, qui voit les deux côtés — la règle ESLint ne s'applique qu'à `src/web`, et `tsconfig.json` n'impose aucun `rootDir`. Les types sont comparés par assignabilité mutuelle à la compilation, les constantes à l'exécution. Le garde-fou a été éprouvé : un seul champ retypé fait échouer `npm run typecheck`.
- **`Application` n'expose ni `oauth`, ni `tokenStore`, ni `secrets`**, et c'est resté vrai après la PR B : le flux OAuth est entièrement **interne** à `createApplication`. `takePendingOAuthState()` a été **remplacé** par `verifyOAuthState(state): boolean`, qui compare en temps constant et ne consomme la demande qu'en cas de correspondance. Aucun appelant ne voit plus jamais le `state` attendu.
- **`src/web/admin/` est encore vide** alors que `routes/pages.ts` route déjà `/admin` vers `/admin/index.html` : c'est l'objet de la PR C. `overlay/`, `shared/` et `setup/` sont livrés.
- **Conséquences concrètes de la CSP**, au-delà de l'interdiction déjà connue des scripts et styles en ligne : `form-action 'none'` interdit tout `<form>` soumissible, donc boutons `type="button"` et `fetch` partout ; `style-src 'self'` interdit la balise `<style>` **et** l'attribut `style=`, mais `element.style.setProperty('--x', v)` via le CSSOM n'est pas concerné par la CSP et reste la voie pour appliquer `OverlayConfig` en variables CSS ; `frame-ancestors 'self'` autorise bien l'aperçu d'apparence en `<iframe src="/overlay">`.
- **`innerHTML` est banni y compris dans les tests** — le bloc `tests/**` d'ESLint ne lève que `no-non-null-assertion`, `no-unnecessary-condition` et `no-console`. Les assertions de non-injection passent donc par `textContent`, `childNodes` ou `querySelectorAll`.
- **`scripts/dc.sh` n'a pas de sous-commande `typecheck:web` ni `coverage`** : passer par `./scripts/dc.sh npm run typecheck:web` et `./scripts/dc.sh npm run test:coverage`. À noter que le `verify` de `dc.sh` enchaîne lint, typecheck, test **et** `npm audit --audit-level=high`, là où le `verify` de `package.json` n'a pas l'audit.
- **Aucun bundler.** Les pages chargent des modules ES natifs par chemin absolu (`<script type="module" src="/admin/main.js">`), et les imports relatifs en TypeScript portent l'extension `.js`. `tsc -p tsconfig.web.json` compile `src/web/**` vers `dist/public/**` avec `rootDir: src/web`, `types: []` et `moduleResolution: "Bundler"`.
- **La couverture inclut déjà `src/web/**`** via `include: ['src/**/*.ts']`, sans exclusion : le code front y comptera dès qu'il existera.

#### PR A — `feat/overlay-web` — **fusionnée (#7), 145 tests, 942 au total**

Dette `tsconfig.web.json` payée, `web/shared/` complet, overlay complet. `npm run typecheck` enchaîne désormais les trois cibles.

| Fichier | Rôle |
| --- | --- |
| `web/shared/protocol.ts` | Contrat de fil redéclaré, plus `parseServerMessage` — un message illisible ne doit pas tuer la boucle de réception d'une page qu'OBS ne rechargera jamais |
| `web/shared/time-format.ts` | `formatRemaining` (troncature, jamais d'arrondi au supérieur) et `formatReward` |
| `web/shared/ws-client.ts` | Machine à états, retrait exponentiel plafonné avec bruit, socket et minuteurs injectés |
| `web/shared/safe-dom.ts` | Seul point d'écriture DOM. `textContent`, retrait des caractères de contrôle et des marques de direction, troncature par graphème |
| `web/shared/countdown.ts` | Interpolation locale et resynchronisation |
| `web/overlay/overlay-style.ts` | `OverlayConfig` vers variables CSS |
| `web/overlay/toast-queue.ts` | Une bulle à la fois, file plafonnée |
| `web/overlay/main.ts`, `index.html`, `overlay.css` | Câblage et présentation |
| `tests/security/xss-overlay.test.ts` | Treize charges utiles hostiles, plus l'audit statique du gabarit |

**Décisions prises pendant cette PR :**

- **La distinction entre resynchronisation `tick` et `authoritative` est le cœur de l'overlay.** Une resynchronisation de routine ne peut que confirmer ou rattraper **à la baisse** : accepter une valeur plus haute ferait remonter le compteur à l'écran une fois par seconde, indéfiniment, puisque l'interpolation locale dérive toujours un peu. Une resynchronisation autoritaire — crédit, action manuelle, instantané reçu au retour d'une coupure — s'impose telle quelle : en mode gel le serveur détient **plus** de temps que l'overlay, qui a continué à décompter dans le vide, et le lui refuser volerait au streamer ce que le gel lui garantit.
- **U+200C et U+200D sont délibérément épargnés** par `safe-dom`. Le liant et l'antiliant sont légitimes en persan, en arabe et dans les écritures indiennes, et U+200D tient ensemble les emoji composés. Les retirer abîmerait des pseudos honnêtes sans rien protéger : ils lient la lecture, ils ne la trompent pas.
- **Troncature par graphème via `Intl.Segmenter`**, et non par point de code : un étalement de chaîne ferait éclater une famille emoji en trois personnes. ESLint l'avait signalé, à raison.
- **Les caractères de contrôle sont décrits par une table de plages en hexadécimal**, jamais écrits en littéral — ni dans le code, ni dans les tests. Un octet invisible dans le source ne se relit pas, ne se revoit pas, et sa disparition accidentelle rendrait le test trivialement vert.
- **Vitest est scindé en deux projets** (`node` et `web`) via `test.projects`, avec `handleDisabledFileLoadingAsSuccess` côté happy-dom : sans ce réglage, chaque chargement de ressource refusé remplit la sortie de piles d'appel qui n'annoncent aucun défaut.
- **Open Props n'est pas encore vendoré** : l'overlay n'en a aucun besoin — fond transparent, tout piloté par les variables `--cc-*`. Le vendorer maintenant reviendrait à livrer un fichier inutilisé. Il arrivera avec la PR C, qui en a l'usage.

**Trois points restés ouverts, à traiter plus tard :**

1. **`overlay.enableCustomCss` n'a aucune route serveur.** Le réglage existe au schéma depuis la Phase 1, mais `static-handler.ts` ne sert que `webRootDirectory` : rien ne lit `custom.css` dans le répertoire de données. Il faudra une route dédiée, avec les mêmes gardes de chemin.
2. **Le mode `server.websocket.mode: 'separate'` n'est pas découvrable depuis la page.** Le message `hello` ne porte que le port HTTP. L'overlay se connecte donc à `window.location.host`, ce qui ne vaut que pour le mode `shared` — qui est le défaut et la décision actée. Ajouter le port WebSocket au `hello` réglerait le sujet.
3. **Les fichiers `.js.map` sont émis dans `dist/public` mais absents de la liste blanche du serveur statique**, donc servis en 404. Sans conséquence fonctionnelle, mais à trancher au packaging (Phase 7) : les exclure du build de production plutôt que les livrer inaccessibles.

#### PR B — `feat/setup-oauth` — **écrite, en attente de fusion, 83 tests, 1 025 au total**

Serveur loopback OAuth, extension d'`Application`, assistant de première configuration.

| Fichier | Rôle |
| --- | --- |
| `core/server/oauth-callback.ts` | Gestionnaire pur du rappel : requête vers réponse, aucun socket |
| `core/server/oauth-callback-server.ts` | Cycle de vie éphémère : armement, TTL de 5 min, extinction |
| `core/twitch/oauth-completion.ts` | Du code reçu à une connexion EventSub vivante |
| `core/config/schema.ts` | Ajout de `setup.completed`, seul état de l'assistant qui soit persisté |
| `web/shared/api-client.ts` | Jeton CSRF, erreurs typées `ApiError` — partagé avec la PR C |
| `web/shared/theme.css` | Tokens sémantiques, thème sombre |
| `web/setup/wizard.ts` | Étape de reprise dérivée de l'état réel |
| `web/setup/index.html`, `setup.css`, `main.ts` | Assistant six étapes |
| `tests/security/xss-setup.test.ts` | Audit du gabarit et cohérence de la redirect URI |

**Décisions prises pendant cette PR :**

- **Le gestionnaire de rappel ne voit jamais le `state` attendu.** Il ne reçoit qu'un `verifyState()` qui répond oui ou non : il ne peut donc ni le journaliser, ni le renvoyer dans une page, ni le laisser fuir dans une URL de redirection.
- **Un `state` erroné ne consomme rien.** N'importe quelle page distante peut provoquer une navigation vers la boucle locale ; si un `state` faux suffisait à clore le flux, le premier venu ferait échouer la connexion du streamer, à distance et en boucle. C'est ce qui a fait remplacer `takePendingOAuthState()` par `verifyOAuthState()`.
- **Le rappel redirige vers `/setup?oauth=ok|denied|failed` au lieu de rendre une page.** L'utilisateur revient dans l'assistant et poursuit là où il en était, et le serveur éphémère n'a presque aucune surface HTML. Seul un code d'issue clos transite : ni le code d'autorisation, ni un message d'erreur de Twitch, qui est du texte contrôlé par un tiers et finirait dans une barre d'adresse.
- **Le port de rappel ne se replie jamais.** Twitch exige une correspondance exacte de la redirect URI : écouter sur 37772 rendrait le rappel introuvable, ce qui serait bien plus déroutant qu'une erreur franche au moment du clic.
- **L'étape de l'assistant est dérivée de l'état réel**, jamais d'un numéro d'étape enregistré — qui se désynchroniserait au premier jeton révoqué depuis Twitch. Seul `setup.completed` est persisté, parce qu'il ne se déduit de rien : la valeur de départ du compteur a toujours une valeur par défaut, on ne peut pas distinguer « laissée telle quelle » de « jamais vue ».
- **La reprise s'arrête à l'écran « chaîne détectée »** et ne va jamais directement au barème : c'est l'écran qui confirme que la connexion a abouti, et déposer quelqu'un sur un formulaire sans le lui montrer laisserait le doute sur l'étape précédente.
- **Une portée manquante n'échoue pas la connexion.** `channel.chat.notification` est facultative depuis la Phase 3 : sans elle le subathon fonctionne, Prime étant traité comme un Tier 1. L'assistant le signale, il ne bloque pas.
- **L'identité de la chaîne vient de la validation du jeton**, et n'écrase jamais une chaîne déjà configurée — le compte qui autorise peut être un bot ou un modérateur, branché exprès.
- **Open Props n'est toujours pas vendoré.** `web/shared/theme.css` définit des tokens sémantiques que la PR C rebasera sur les primitives Open Props sans toucher à une seule règle de composant. Le vendorer maintenant n'aurait rien changé au rendu de l'assistant.

**Un point resté ouvert :** l'assistant n'est atteignable qu'en tapant `/setup`, `/` redirigeant vers `/admin` depuis la Phase 4. Une fois `setup.completed` disponible, `/` devrait rediriger vers `/setup` tant qu'il vaut `false`. C'est une modification de `routes/pages.ts`, qui appartient naturellement à la PR C — celle qui livre `/admin`.

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
