# ChronoCast — Document de reprise

Ce document permet de reprendre le développement depuis une fenêtre de contexte vierge, sans aucune analyse préalable ni question à poser. Il décrit l'objectif, ce qui est fait, ce qui reste, et toutes les règles et décisions en vigueur.

**Dernière mise à jour :** 2 août 2026, après fusion de la PR #16. **Phases 0 à 7 terminées.** L'installeur Windows est produit, s'installe et se lance, et **le flux OAuth aboutit de bout en bout** — autorisation Twitch, rappel reçu, chaîne détectée. Le défaut d'ergonomie qui le suivait — la configuration se poursuivait dans le navigateur — **est corrigé et fusionné** ; il reste à le voir fonctionner sur poste Windows, ce que le conteneur ne peut pas montrer (section 0). **La version est passée à `0.2.0`.** S'y ajoutent deux nouveautés d'apparence livrées à la demande de l'utilisateur — **cadre et dégradé**, PR #17 — décrites en section 0 bis, dont une correction d'ergonomie reste à fusionner. Il ne reste ensuite que la **Phase 8, la documentation**.

**Le `.exe` existe, il s'installe et il se lance.** Le workflow `Release` a produit l'installeur, l'installation aboutit, et l'application démarre sur l'assistant de première configuration avec son icône. **La Phase 7 est donc éprouvée, et pas seulement écrite.** Il reste à valider le reste du parcours sur poste Windows — la liste est en section 8, sous Phase 7.

**La dette actée pendant la PR C a été tranchée par le retrait** : `server.websocket.mode` et `server.websocket.port` ne sont plus au schéma. L'arbitrage et ses conséquences sont en **section 7, sous « Dette soldée »**. Il n'y a plus rien à décider sur ce sujet.

---

## 0. Retour dans la fenêtre après le flux OAuth — corrigé, à voir tourner sur poste

> **À lire en premier.** Correctif fusionné (PR #16), vérifié en conteneur. **Reste à observer sur poste Windows** : la moitié qui ramène la fenêtre au premier plan est la seule chose que le conteneur ne peut pas montrer. La `0.2.0` est la première version qui la porte.

**Le défaut, tel qu'il a été constaté.** Le flux OAuth aboutissait — Twitch autorisait, le rappel arrivait, la chaîne était détectée — mais l'assistant **se poursuivait dans le navigateur**. L'utilisateur se retrouvait avec deux assistants ouverts : celui de la fenêtre ChronoCast, resté à l'étape 3, et celui du navigateur, à l'étape 5. Il terminait sa configuration dans le mauvais des deux, et la fenêtre ne se mettait jamais à jour.

**La cause était de conception, pas d'implémentation.** `core/server/oauth-callback.ts` répondait `302` vers `/setup?oauth=ok`, et le navigateur suivait. C'était la décision de la PR B — « le rappel redirige vers l'assistant plutôt que de rendre une page morte » — et elle était **juste pour le point d'entrée headless**, où le navigateur est la seule interface. La Phase 6 a introduit une fenêtre applicative sans que cette décision soit rouverte : elle est devenue fausse à ce moment-là.

**La correction, en deux moitiés dont aucune ne suffit seule.**

1. **Côté navigateur** — `oauth-callback.ts` rend désormais une **page terminale** : un message par issue, et rien d'autre. Ce que la PR B avait acté est préservé et vérifié par des tests : ni code d'autorisation, ni message d'erreur de Twitch — texte contrôlé par un tiers — n'y figure, et la CSP reste `default-src 'none'`.
2. **Côté application** — nouvel événement de bus **`oauth:settled`**, émis par `application.ts` à la clôture du flux, avec l'issue. `main/main.ts` s'y abonne, ramène la fenêtre par `showWindow()` et la recharge.

**Trois décisions valent d'être connues avant d'y toucher.**

- **Un événement dédié, et non `twitch:status`.** Celui-ci change à chaque reconnexion EventSub, y compris en plein direct : y accrocher le retour au premier plan ferait passer la fenêtre par-dessus OBS pendant un stream. `oauth:settled` n'est émis qu'à la clôture d'un flux d'autorisation.
- **L'issue voyage avec l'événement, et un échec ramène la fenêtre autant qu'une réussite.** C'est même là que c'est le plus utile : sans cela, l'utilisateur reste devant un assistant muet qui ne dit pas pourquoi rien ne s'est passé. Le test d'intégration couvre exactement ce cas — l'échange échoue, faute de réseau, et le bus annonce `failed`.
- **La destination du rechargement est prise dans un ensemble clos de deux pages** (`/setup`, `/admin`), décidée par le module pur `main/oauth-return.ts` — la coquille ne décide de rien. Cette URL part dans `loadURL` : filtrer les formes hostiles une à une aurait laissé passer la suivante, une liste blanche non. Tout ce qui n'est pas l'une de ces deux pages sous l'origine applicative retombe sur l'assistant.

**Le mode headless ne régresse pas.** La page terminale porte un lien vers `/setup?oauth=<issue>` quand le port applicatif est connu — c'est le seul retour possible sans fenêtre. Il est formulé comme un **recours** (« si ChronoCast ne réagit pas ») et non comme la suite du parcours : dans l'application, le suivre ramènerait exactement le défaut qu'on vient de corriger.

**Ce qui reste à valider à la main, sur poste Windows :** que la fenêtre revienne réellement au premier plan à la fin du flux, y compris repliée dans le tray, et que l'assistant s'y remette à l'étape suivante. Le conteneur ne dira rien de cette partie — c'est `showWindow()` et `loadURL`, dans les trois fichiers qui importent `electron`.

---

## 0 bis. Apparence — cadre et dégradé

Deux sections de plus au schéma de l'overlay, **éteintes par défaut** : la scène OBS d'un utilisateur existant est déjà cadrée sur ce qu'il voit, et une nouveauté d'apparence ne doit rien y déplacer tant qu'il ne l'a pas demandée.

- **`overlay.gradient`** — deux couleurs, un angle, et **deux cibles indépendantes** : `onText` et `onFrame`. Vouloir le dégradé sur les chiffres n'implique pas de le vouloir sur le cadre. Les couleurs, elles, restent communes : les dédoubler n'aurait servi qu'à donner l'occasion de les désaccorder.
- **`overlay.frame`** — épaisseur, arrondi, marges intérieures, couleur, remplissage et son opacité. À ne pas confondre avec `overlay.outline`, qui cerne les glyphes ; le champ correspondant a d'ailleurs été renommé « Contour des chiffres », la confusion ayant eu lieu pour de vrai.

**Trois contraintes de rendu expliquent la forme du code, et se paieraient cher à redécouvrir.**

1. **Le trait du cadre est un `padding` peint par le fond, pas une bordure.** `border-image` est la façon évidente de faire un trait en dégradé, et elle fait perdre `border-radius`. Il fallait choisir entre le dégradé et les coins ronds : cette construction garde les deux.
2. **Un dégradé de texte passe par `background-clip: text`**, ce qui impose `color: transparent`. D'où le couple `--cc-text-fill` / `--cc-text-background`, et la règle qui va avec : la couleur doit redevenir opaque dès que le dégradé s'éteint, sans quoi **le compteur disparaît de la scène**.
3. **D'où deux enveloppes autour du compteur** (`.frame`, `.frame__inner`) : le remplissage ne peut pas vivre sur l'élément du texte, il serait découpé à la forme des chiffres.

**L'intérieur du cadre est libre par défaut** (`fillOpacity: 0`). Un cadre est un trait, pas un pavé : le premier défaut retenu, un noir à 0,4, laissait le dégradé transparaître à travers et faisait passer le cadre pour un fond plein — défaut corrigé sur retour d'usage, avant même la fusion.

**L'opacité du remplissage est un réglage distinct de sa couleur** parce que `<input type="color">` ne sait pas exprimer la transparence. Les deux sont recomposés en notation à huit chiffres par `withOpacity`, qui développe la notation courte `#RGB` et remplace une opacité déjà portée par la couleur.

**Le logo du panneau** était resté un caractère `◷` posé en Phase 5. `scripts/prepare-icons.mjs` engendre désormais aussi `src/web/shared/logo.png` en 128 px depuis `assets/logo.png` — dans les sources et non dans `assets/`, car `copy-web-assets.mjs` ne recopie que `src/web/**`. Il sert de marque dans la barre latérale et de favicon sur le panneau comme sur l'assistant. `icon.ico` et `tray.png` ressortent identiques au bit près de la régénération.

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
| WebSocket | **Attaché au serveur HTTP, sans alternative** | Un seul port à configurer. Le mode `separate`, jamais implémenté, a été retiré du schéma — voir « Dette soldée » en section 7 |
| Redirect URI OAuth | **`http://localhost:37771/callback`**, serveur loopback éphémère sur IPv4 **et** IPv6 | Twitch exige HTTPS partout **sauf pour le nom littéral `localhost`** — l'exception ne couvre pas `127.0.0.1`, que la console refuse. Et `localhost` étant un nom, il mène souvent à `::1` sous Windows : il faut écouter les deux adresses de bouclage |

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
- `src/main/**` (Phase 6) est une coquille Electron mince : cycle de vie, fenêtre, tray, et implémentations concrètes des ports. **Trois fichiers seulement y importent `electron`**, et aucun ne prend de décision — la politique de navigation, le modèle du menu, le magasin de secrets et l'ouverture de navigateur sont tous purs et testés.

De la même façon, `Clock` expose **deux** horloges : `now()` pour les horodatages, qui peut reculer lors d'un changement d'heure, et `monotonicMs()` pour mesurer des durées, qui ne recule jamais. C'est `monotonicMs()` qui fait décompter le compteur, faute de quoi le passage à l'heure d'hiver offrirait une heure de subathon.

---

## 6. État actuel du dépôt

**Branche courante : `fix/cadre-anneau-et-degrade-ciblable`**, PR non fusionnée à l'heure où ces lignes sont écrites. Les dix-sept PR précédentes sont fusionnées en squash ; `main` est sur `0937d9b`.

```
0937d9b feat(overlay): cadre et dégradé (#17)                                <- main
0c9fa9c fix(oauth): ramener la configuration dans la fenêtre (#16)
ae3f7de fix(oauth): rediriger vers localhost (#15)
a01167c fix(windows): canoniser la racine servie, figer les fins de ligne (#14)
0bc9120 chore(packaging): electron-builder et workflows GitHub (#13)
4078cb6 chore(assets): identité visuelle définitive (#12)
c93202f Phase 6 — Coquille Electron (#11)
1720d70 refactor(config): retirer le mode WebSocket « separate » (#10)
1726b53 Phase 5 : PR C - Panneau d'administration (#9)
6b1bec1 feat(setup): flux OAuth complet et assistant de configuration (#8)
67d9219 feat(web): fondations web et overlay OBS (#7)
eb02663 Phase 4 — Serveurs locaux et point d'entrée headless (#6)
28cf0c4 docs: ajouter le document de reprise et rendre docs/ versionnable (#5)
6da9bfd Module Twitch : OAuth, Helix, EventSub, conversion et déduplication (#4)
c7d5c64 Métier du compteur : réducteurs purs, barème et service (#3)
b93615c Fondations du noyau : journalisation, persistance, configuration (#2)
ce9b342 chore(build): mettre en place le socle d'outillage conteneurisé (#1)
18969d2 chore: initialiser le dépôt ChronoCast
```

**1 515 tests, 70 fichiers. Lint, les trois typechecks et `npm audit --audit-level=high` sans erreur** — y compris avec `electron` dans l'arbre. (1 339 après le retrait de la dette, plus les **118 tests** de la Phase 6, les **9** de l'identité visuelle les **10** du packaging les **3** de la portabilité Windows, les **7** du rappel OAuth, les **10** du retour dans la fenêtre et les **19** du cadre et du dégradé.)

**Rien en attente hors du travail de la branche.** `git status` ne doit signaler aucun fichier une fois la branche commitée — `dist/`, `release/` et `PR-*.md` sont ignorés.

**La version est passée à `0.2.0`**, à deux endroits qui doivent rester alignés : `package.json` — d'où electron-builder tire le nom de l'installeur et `app.getVersion()` — et la constante `APP_VERSION` de `src/headless/index.ts`, qui n'a pas accès au premier. Rien ne vérifie automatiquement cet alignement : la seule garde est de les modifier ensemble.

### Première action à la reprise

```bash
git branch --show-current    # fix/cadre-anneau-et-degrade-ciblable tant que la PR n'est pas fusionnée
./scripts/dc.sh verify       # doit être intégralement vert (1 515 tests)
```

**La suite de la Phase 7 ne commence pas par du code, mais par un clic** : déclencher manuellement le workflow `Release` pour obtenir un premier `.exe`. La marche à suivre est en section 8. Tant que ce build n'a pas tourné, rien de ce qui a été écrit n'a jamais été exécuté sous Windows.

**Le changement de régime a eu lieu en Phase 6, et il vaut aussi pour la suite :** le conteneur ne vérifie plus tout. `main/main.ts`, `main/windows.ts` et `main/tray.ts` importent `electron`, qu'aucun Chromium ne peut lancer ici — ils sont nommément exclus de la couverture, et éprouver leur comportement passe par vos mains sous Windows. La parade tient en une phrase : **tout ce qui décide est extrait de la coquille en modules purs**, exactement comme `src/core/**` l'a été des ports. La Phase 7 va plus loin encore, puisqu'elle produit un artefact que seul un poste Windows peut exécuter.

---

## 7. Ce qui est fait — Phases 0 à 7

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

### Phase 5 — Interfaces web — **terminée**

Découpée en trois branches successives (voir « Décisions actées » plus bas) :

| PR | Branche | État |
| --- | --- | --- |
| A | `feat/overlay-web` | **Fusionnée (#7)** — dette `tsconfig.web.json` payée, `web/shared/` complet, overlay complet |
| B | `feat/setup-oauth` | **Fusionnée (#8)** — serveur loopback OAuth, extension d'`Application`, assistant de première configuration |
| C | `feat/admin-web` | **Fusionnée (#9)** — panneau d'administration et ses huit vues, 312 tests |

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
2. **Le mode `server.websocket.mode: 'separate'` n'est pas découvrable depuis la page.** ~~Le message `hello` ne porte que le port HTTP.~~ **Clos autrement que prévu :** l'analyse du lot 1 de la PR C a montré que le `hello` ne pouvait rien y faire — il arrive *sur* la connexion, donc il faut déjà avoir joint le bon port pour le lire. Le mode n'ayant par ailleurs aucune implémentation, il a été retiré. Voir « Dette soldée » en section 7.
3. **Les fichiers `.js.map` sont émis dans `dist/public` mais absents de la liste blanche du serveur statique**, donc servis en 404. Sans conséquence fonctionnelle, mais à trancher au packaging (Phase 7) : les exclure du build de production plutôt que les livrer inaccessibles.

#### PR B — `feat/setup-oauth` — **fusionnée (#8), 83 tests, 1 025 au total**

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
- **Le rappel rend une page terminale portant un code d'issue clos** — `ok`, `denied` ou `failed`. Il redirigeait à l'origine vers `/setup?oauth=…`, ce qui a dû être défait dès qu'une fenêtre applicative a existé : voir section 0. Ce qui n'a pas bougé, et qui était le fond de la décision : le serveur éphémère n'a presque aucune surface HTML, et seul ce code transite — ni le code d'autorisation, ni un message d'erreur de Twitch, qui est du texte contrôlé par un tiers.
- **Le port de rappel ne se replie jamais.** Twitch exige une correspondance exacte de la redirect URI : écouter sur 37772 rendrait le rappel introuvable, ce qui serait bien plus déroutant qu'une erreur franche au moment du clic.
- **L'étape de l'assistant est dérivée de l'état réel**, jamais d'un numéro d'étape enregistré — qui se désynchroniserait au premier jeton révoqué depuis Twitch. Seul `setup.completed` est persisté, parce qu'il ne se déduit de rien : la valeur de départ du compteur a toujours une valeur par défaut, on ne peut pas distinguer « laissée telle quelle » de « jamais vue ».
- **La reprise s'arrête à l'écran « chaîne détectée »** et ne va jamais directement au barème : c'est l'écran qui confirme que la connexion a abouti, et déposer quelqu'un sur un formulaire sans le lui montrer laisserait le doute sur l'étape précédente.
- **Une portée manquante n'échoue pas la connexion.** `channel.chat.notification` est facultative depuis la Phase 3 : sans elle le subathon fonctionne, Prime étant traité comme un Tier 1. L'assistant le signale, il ne bloque pas.
- **L'identité de la chaîne vient de la validation du jeton**, et n'écrase jamais une chaîne déjà configurée — le compte qui autorise peut être un bot ou un modérateur, branché exprès.
- **Open Props n'est toujours pas vendoré.** `web/shared/theme.css` définit des tokens sémantiques que la PR C rebasera sur les primitives Open Props sans toucher à une seule règle de composant. Le vendorer maintenant n'aurait rien changé au rendu de l'assistant.

**Un point resté ouvert :** l'assistant n'est atteignable qu'en tapant `/setup`, `/` redirigeant vers `/admin` depuis la Phase 4. Une fois `setup.completed` disponible, `/` devrait rediriger vers `/setup` tant qu'il vaut `false`. C'est une modification de `routes/pages.ts`, qui appartient naturellement à la PR C — celle qui livre `/admin`.

#### PR C — `feat/admin-web` — **fusionnée (#9), 312 tests, 1 337 au total**

C'est **la plus lourde des trois**, probablement plus que les PR A et B réunies : huit vues, un routage par hash, une couche de liaison de formulaires pour environ soixante-dix réglages, l'aperçu d'apparence en `<iframe>`, la vendorisation d'Open Props, et la bascule de `/`. Ne pas l'attaquer d'un bloc.

**Découpage retenu, chaque lot utilisable seul, les trois sur `feat/admin-web` en trois commits pour une seule PR :**

1. **Socle** — **fait, 87 tests, 1 112 au total.** Open Props 1.7.23 vendoré, `theme.css` rebasé, port WebSocket découvrable, redirection de `/` vers `/setup`, routage par hash, coquille du panneau avec navigation latérale, et vue *tableau de bord* branchée sur le WebSocket. Détail plus bas.
2. **Vues de saisie** — **fait, 124 tests, 1 236 au total.** Couche de liaison, table de descripteurs, vues barème, apparence avec aperçu live, Twitch, paramètres, import/export, et la route `custom.css`. Détail plus bas.
3. **Vues de consultation** — **fait, 101 tests, 1 337 au total.** Historique et journaux, avec filtres, pagination et alimentation au fil de l'eau. Détail plus bas.

**Travaux tracés depuis les PR précédentes, tous traités :**

- **Vendorer Open Props** (lot 1) selon la décision actée : fichier unique dans `src/web/shared/`, non modifié, en-tête portant version, licence MIT et SHA-256, récupéré par `npm pack open-props@<version>` dans le conteneur puis extraction — pas de `curl`. `web/shared/theme.css` existe déjà et n'expose que des tokens sémantiques : le rebasage ne doit toucher **aucune** règle de composant, ni dans `setup.css`, ni ailleurs.
- **Faire pointer `/` vers `/setup` tant que `setup.completed` vaut `false`.** La redirection actuelle vers `/admin` date de la Phase 4, avant que ce réglage existe. Un nouvel utilisateur doit tomber sur l'assistant, pas sur un panneau qu'il ne peut pas encore remplir. Modification de `routes/pages.ts`, qui devra recevoir un accès à la configuration.
- **Route de `custom.css`** pour honorer `overlay.enableCustomCss`, tracé depuis la PR A. Le réglage existe au schéma depuis la Phase 1 mais `static-handler.ts` ne sert que `webRootDirectory` : il faut une route dédiée lisant le répertoire de données, avec les mêmes gardes de chemin.
- **Le port WebSocket** : traité par le lot 1 côté client, et refermé depuis par le retrait du mode `separate`. Voir « Dette soldée » en section 7.

#### Lot 1 de la PR C — livré, 87 tests

| Fichier | Rôle |
| --- | --- |
| `web/shared/open-props.css` | Open Props 1.7.23 vendoré, en-tête portant version, licence MIT et SHA-256 |
| `web/shared/theme.css` | Tokens rebasés sur les primitives, plus ceux dont le panneau a besoin |
| `web/shared/ws-url.ts` | Lecture du marqueur de port et composition de l'URL du socket |
| `web/admin/router.ts` | Liste close des vues, hash tolérant en forme et strict en fond |
| `web/admin/dashboard-model.ts` | Réducteur immuable des messages en modèle d'affichage |
| `web/admin/index.html`, `admin.css`, `main.ts` | Coquille, navigation latérale, câblage |
| `core/server/routes/pages.ts` | Second marqueur, et redirection de `/` selon `setup.completed` |
| `tests/security/xss-admin.test.ts` | Audit du gabarit |
| `tests/unit/assets/open-props-vendor.test.ts` | Recalcul du condensat du fichier vendoré |

**Décisions prises pendant ce lot :**

- **Le rebasage sur Open Props est partiel, et c'est délibéré.** Ses échelles ne coïncident pas avec les valeurs déjà livrées : rayons de 5px et 1rem là où l'assistant emploie 6px et 10px, pas de 2.5rem dans l'échelle d'espacement, ombres réglées sur `prefers-color-scheme` alors que le thème est sombre quoi qu'en dise le poste. Aligner de force aurait changé le rendu d'une page déjà relue — ce n'est pas un rebasage mais une refonte déguisée. La règle écrite en tête de `theme.css` : un token référence la primitive quand elle vaut **exactement** la valeur retenue, sinon il garde son littéral avec la raison en commentaire. Une couche de tokens sémantiques a le droit de porter des valeurs que les primitives ne fournissent pas ; c'est ce qui la distingue d'un alias. Les nouveaux tokens du panneau, eux, sont tous adossés aux primitives, n'ayant aucun rendu antérieur à préserver.
- **Le condensat du fichier vendoré porte sur le contenu hors en-tête**, et un test le recalcule à chaque exécution de la suite. Un remplacement silencieux du fichier fait donc échouer la suite, ce qu'on attend d'un fichier réputé non modifié.
- **La liste des vues s'allonge lot par lot** plutôt que d'annoncer d'emblée les huit. Une entrée de navigation menant à une section inexistante ferait lever `requireElement` au premier clic, et chaque lot doit rester utilisable seul.
- **Le modèle du tableau de bord renvoie l'état identique par référence** quand un message ne change rien, exactement comme les réducteurs du noyau : la vue s'en sert pour ne pas repeindre une liste inchangée à chaque battement.
- **Rien n'est assaini dans le modèle.** Les pseudos le traversent tels quels et ne sont nettoyés qu'à l'écriture, par `safe-dom`. Deux endroits où s'en souvenir, c'est un endroit où l'oublier.
- **Le tableau de bord retient aussi les événements non crédités.** Un don écarté par le plafond est précisément celui qui intrigue.

#### Lot 2 de la PR C — livré, 124 tests

| Fichier | Rôle |
| --- | --- |
| `web/admin/form-binding.ts` | Conversion, comparaison et reconstruction du fragment de configuration. Ne connaît pas le DOM |
| `web/admin/fields.ts` | Table des descripteurs, leurs groupes, et les réglages délibérément écartés avec leur raison |
| `web/admin/render-fields.ts` | Peinture et relecture des champs. Seule frontière d'écriture DOM de la couche de réglage |
| `web/admin/bits-tiers.ts` | Éditeur des paliers de bits, seul réglage à cardinalité variable |
| `core/server/routes/custom-css.ts` | Feuille personnelle de l'overlay, lue dans le répertoire de données |
| `core/server/router.ts` | Aiguillage étendu : API, pages, feuille personnelle, statique |
| `web/admin/index.html`, `admin.css`, `main.ts` | Cinq vues de plus, et leur câblage |

**Décisions prises pendant ce lot :**

- **Les champs sont engendrés depuis la table, pas écrits dans le gabarit.** Recopier soixante-dix champs en HTML créerait une seconde source de vérité, et une faute de frappe entre un sélecteur et son descripteur ne se verrait qu'à l'usage — un réglage « qui ne s'enregistre pas », sans message ni trace.
- **La table est confrontée au schéma par un test.** `tests/unit/web/admin/fields.test.ts` vérifie que chaque descripteur désigne un chemin réel, que son genre correspond au type de la valeur par défaut, que ses bornes la laissent passer, et surtout que **chaque feuille de la configuration est liée ou explicitement écartée**. C'est l'exigence « aucune valeur métier codée en dur » rendue mécanique : un réglage ajouté au schéma sans champ fait échouer la suite.
- **Cinq réglages sont écartés, chacun avec sa raison** dans `UNBOUND_PATHS` : `schemaVersion` et `setup.completed` ne sont pas des réglages, `twitch.broadcasterUserId` et `broadcasterLogin` viennent d'OAuth, et `rewards.bits.tiers` a son éditeur. (Ils étaient sept : `server.websocket.mode` et `port` y figuraient comme sans effet, jusqu'à leur retrait du schéma — voir « Dette soldée » en section 7.)
- **Seuls les champs modifiés partent.** Renvoyer les soixante-dix à chaque enregistrement écraserait une valeur changée entre-temps par l'assistant resté ouvert dans une fenêtre voisine.
- **Rien ne part tant qu'une saisie est fautive.** Un enregistrement partiel laisserait l'utilisateur croire au succès. Chaque faute est nommée sous son champ plutôt que renvoyée en `400` générique.
- **La virgule décimale est acceptée.** Un clavier français en produit une, et la refuser serait une régression d'ergonomie par rapport au soin mis dans les messages du serveur.
- **Un doublon de seuil de bits est refusé.** Le barème compare avec un `>` strict et garde le premier des ex æquo, c'est-à-dire un ordre de saisie que rien n'affiche : le résultat serait imprévisible. Le tri, lui, n'est qu'un confort de lecture — le barème tolère n'importe quel ordre.
- **L'aperçu d'apparence n'a besoin d'aucun `postMessage`.** Un `PATCH /api/config` diffuse un message `config` sur le WebSocket, que l'overlay du cadre applique de lui-même. Le cadre n'est chargé qu'à la première ouverture de la vue : le charger d'emblée ouvrirait une seconde connexion WebSocket qui vivrait tout le direct pour un cadre que personne ne regarde.
- **Le gestionnaire de `custom.css` passe après les pages et avant le statique.** Après, pour qu'il ne puisse jamais masquer une page ; avant, parce que le fichier vit dans le répertoire de données où le gestionnaire statique ne sait pas aller. Il reprend le contrat `serve(pathname) → HttpResponse | null` des pages, et surtout leur discipline : canonisation puis vérification que le chemin est resté sous la racine. La seule vraie surface est le lien symbolique — `tokens.json` est le voisin immédiat du fichier servi.
- **Le bandeau est effacé avant l'action, jamais après.** L'effacer après emporterait le message que l'action vient elle-même d'afficher.

#### Lot 3 de la PR C — livré, 101 tests

| Fichier | Rôle |
| --- | --- |
| `web/admin/history-view.ts` | Filtrage, recherche, pagination et mise en forme du détail |
| `web/admin/log-view.ts` | Tampon plafonné, seuil de niveau, filtre par portée |
| `web/admin/index.html`, `admin.css`, `main.ts` | Deux vues de plus, et leur câblage |
| `tests/security/xss-admin-lists.test.ts` | Non-interprétation du contenu hostile dans les deux vues |

**Décisions prises pendant ce lot :**

- **La recherche est une inclusion de sous-chaîne, jamais une expression régulière.** Un pseudo Twitch peut contenir n'importe quoi, et un `(` tapé dans le champ ferait lever la construction du motif — la vue deviendrait inutilisable au moment précis où l'on cherche le pseudo qui pose problème.
- **La page hors bornes est ramenée dans les bornes, pas refusée.** Un filtre peut réduire la liste alors qu'on se trouve sur la dernière page ; sans ce recadrage, l'écran se viderait sans explication. Tout changement de filtre ramène par ailleurs à la première page.
- **`paginate` annonce au moins une page**, même pour une liste vide : zéro ferait afficher « page 1 sur 0 ».
- **Le filtre de niveau des journaux est un seuil minimal**, comme celui du serveur dans `routes/api.ts`. Les deux doivent s'accorder, sinon un rechargement changerait ce que la page affiche. Un niveau inconnu laisse tout passer plutôt que de tout masquer : une page vide et muette est le pire des retours.
- **Les portées sont filtrées par préfixe**, pas par égalité : demander `twitch` ramène `twitch:eventsub`, faute de quoi le filtre obligerait à connaître l'arborescence des composants pour s'en servir.
- **Le tampon des journaux est plafonné à 2 000 enregistrements**, plus large que le tampon circulaire du serveur puisque la page accumule aussi ce qui arrive après le chargement. Ce sont les plus anciens qui partent : un journal consulté en direct sert à voir ce qui vient d'arriver.
- **La pause fige l'affichage, pas la collecte.** Le tampon continue de se remplir : figer sert à lire une pile d'appel, pas à perdre ce qui arrive pendant qu'on la lit.
- **Le rechargement des journaux repart de zéro.** Conserver ce que le WebSocket a déjà livré ferait apparaître deux fois les enregistrements présents dans les deux sources.
- **Le contexte d'un enregistrement est écrit en JSON indenté dans un seul nœud texte**, jamais reconstruit en éléments : sa profondeur et son contenu viennent de l'exécution, et le reconstruire rendrait ce contenu capable de créer des nœuds.
- **Un palier ou un détail inconnu traverse tel quel.** L'historique est relu d'un fichier JSONL qu'une version antérieure a pu écrire : deviner sa forme serait afficher autre chose que ce qui s'est passé.
- **Le test d'injection est un test de caractérisation**, écrit après le code qu'il couvre, et il est passé vert du premier coup. C'est assumé : il ne pilote aucun code neuf, il fige la garantie exigée par la section 9 pour deux vues qui affichent du contenu **stocké** puis relu longtemps après. Sa non-vacuité a été vérifiée séparément — happy-dom crée bien des éléments quand du HTML est réellement analysé, donc `querySelectorAll('*')` à zéro veut dire quelque chose.
- **Le nom d'un fichier de test décide de son environnement.** Un fichier de `tests/security/` qui ne commence pas par `xss-` tourne dans le projet `node`, sans DOM. Constaté en direct pendant ce lot, sur un fichier temporaire : `DOMParser` y est simplement absent, et l'échec ne dit pas pourquoi.

### Dette soldée — le mode `separate` du WebSocket a été retiré

> **Statut : soldée (PR #10).** Traitée sur sa propre branche, avant la Phase 6. **Ne pas rouvrir le sujet** : cette section n'est conservée que pour que la décision et sa raison survivent au retrait du code.

Le constat, découvert pendant le lot 1 de la PR C : `server.websocket.mode` et `server.websocket.port` étaient déclarés au schéma et **lus nulle part**. L'adaptateur WebSocket est branché sur l'événement `upgrade` du serveur HTTP sans condition, quel que soit le réglage. Régler `mode: 'separate'` ne produisait donc aucun effet observable — ni erreur, ni changement de comportement. C'était une dette de la **Phase 4**, pas de la Phase 5.

**Arbitrage retenu : le retrait**, parmi les trois issues qui avaient été posées (implémenter, retirer, documenter). Les raisons, dans l'ordre où elles pèsent :

- `shared` est la décision actée de la section 4, et rien dans le produit n'a besoin d'un second écouteur ;
- la V1 vise un `.exe` grand public, où chaque réglage inutile est une question de support en plus ;
- implémenter aurait ajouté un serveur au cycle de vie, deux gardes de sécurité à ne pas oublier — `Host` et `Origin` — et des tests d'intégration, pour un mode que personne n'a demandé ;
- documenter aurait laissé en place ce qu'il fallait précisément faire disparaître : un réglage qui promet un comportement qu'il ne produit pas.

Le retrait a été **gratuit en migration**, et c'est le mode `strip` du schéma qui le permet : une configuration écrite par une version antérieure porte encore les deux clés, elles sont écartées silencieusement, et l'application démarre. Un test le fige (`tests/unit/config/schema.test.ts`, « accepte une configuration héritée portant l'ancien mode WebSocket »).

**Ce que le retrait a touché**, et rien d'autre : les deux clés de `core/config/schema.ts`, les deux entrées correspondantes d'`UNBOUND_PATHS` dans `web/admin/fields.ts`, et le commentaire de `currentWsPort()` dans `core/app/application.ts`, qui décrivait une dette et décrit désormais un fait. Le garde-fou du lot 2 de la PR C a fonctionné exactement comme prévu : retirer les clés du schéma a fait échouer `fields.test.ts` de lui-même, sur le test « n'écarte que des chemins qui existent réellement ».

**Ce qui a été délibérément conservé**, et qu'il ne faut pas retirer par zèle : `web/shared/ws-url.ts`, le marqueur `__CHRONOCAST_WS_PORT__` substitué par `routes/pages.ts` sur les trois pages, et le champ `wsPort` du message `hello` des deux côtés du contrat. Ce n'est pas un réglage mensonger mais de la plomberie devenue trivialement exacte : le port annoncé est toujours celui de la page servie, y compris après un repli de port. Coût nul, dix-huit tests déjà verts, et le point d'accroche reste nommé si la question revenait un jour.

**Ce qui est déjà en place et ne doit pas être réécrit :** `web/shared/api-client.ts` (jeton CSRF, erreurs `ApiError` typées), `ws-client.ts`, `countdown.ts`, `safe-dom.ts`, `time-format.ts`, `protocol.ts`, `theme.css`, `ws-url.ts` et `open-props.css`. Les trois pages les consomment tels quels.

### Phase 6 — Coquille Electron — **livrée (PR #11)**, 2 commits, 118 tests

**Principe qui gouverne toute la phase :** seuls **trois fichiers** importent `electron` — `main/main.ts`, `main/windows.ts`, `main/tray.ts` — et aucun des trois ne prend de décision. Tout ce qui se décide vit dans des modules purs, testés dans le conteneur. L'exclusion de couverture de `vitest.config.ts` est **nominative** sur ces trois fichiers, et non plus `src/main/**` : une logique laissée dans la coquille s'y verrait désormais par son absence de la couverture.

`electron` est en **devDependency, version exacte `43.2.0`**. En dépendance de développement parce qu'electron-builder refuse de packager autrement ; en version figée parce qu'elle détermine le Chromium embarqué, seul composant dont le runtime n'est vérifiable ni en conteneur ni en CI. `ELECTRON_SKIP_BINARY_DOWNLOAD=1` et `--ignore-scripts` font qu'aucun binaire n'est téléchargé : `electron.d.ts` suffit au typecheck. `npm audit --audit-level=high` reste à zéro.

#### Commit 1 — ports et runtime partagé, 68 tests

| Fichier | Rôle |
| --- | --- |
| `core/app/fs-path-provider.ts` | **Déplacé** depuis `src/headless/`, aux côtés de `system-clock` et `system-ticker` : il a désormais deux appelants. N'était couvert par aucun test alors qu'il porte une garde de chemin |
| `core/app/node-runtime.ts` | Câblage commun aux deux points d'entrée : minuteurs, fabrique de sockets, `fetch` lié, temporisation |
| `main/safe-storage-secret-store.ts` | `SecretStore` sur `safeStorage` **injecté** — aucun import d'`electron`, donc entièrement testable |
| `main/browser-opener.ts` | `BrowserOpener` sur `openExternal` injecté, garde `https:` couverte dans `tests/security/` |

**Décisions prises pendant ce commit :**

- **`defaultWebRoot` prend l'URL du point d'entrée appelant**, au lieu de se mesurer depuis son propre module. Enfouie dans `core/app`, elle aurait renvoyé `dist/core/public`. `dist/headless/index.js` et `dist/main/main.js` sont chacun à un niveau sous `dist/`, si bien que les deux donnent `dist/public` et qu'une réorganisation de `src/core` ne peut plus la casser.
- **Le magasin `safeStorage` ne se replie jamais en clair.** Chiffrement indisponible, écriture refusée : un jeton OAuth lisible sur le disque serait pire que l'échec, puisqu'il donnerait l'illusion inverse de la vérité.
- **Sa lecture ne lève jamais.** Un blob indéchiffrable vaut un secret absent, et l'utilisateur retombe sur l'assistant plutôt que sur un écran de crash. Le cas est réel : DPAPI liant le chiffrement au compte Windows, un répertoire de données recopié depuis un autre compte est illisible par construction.
- **`safeStorage` n'est jamais interrogé à la construction**, seulement à l'usage : il n'est utilisable qu'après `app.whenReady()`, alors que la composition de l'application le précède.
- **L'ouverture de navigateur analyse l'URL** au lieu de comparer un préfixe : elle accepte `HTTPS://` et rejette ce qui n'a d'URL que l'apparence. Elle rejette sans jamais lever de façon synchrone, faute de quoi l'erreur passerait à côté du `catch` de l'appelant.
- **Un test s'est révélé faux, pas le code** : `resolveDataFile('/etc/passwd')` ne lève pas, parce que `join` aplatit un segment absolu — c'est `resolve` seul qui l'aurait laissé reprendre la main. Le chemin reste sous la racine, ce que le contrat exige.

#### Commit 2 — la coquille, 50 tests

| Fichier | Rôle |
| --- | --- |
| `main/navigation-policy.ts` | **Pur.** `allow` / `external` / `block`. Pièce de sécurité de la phase, couverte par `tests/security/` |
| `main/tray-menu.ts` | **Pur.** Modèle du menu et mise en forme de la durée |
| `main/windows.ts` | Fenêtre durcie, repli vers le tray à la fermeture |
| `main/tray.ts` | Icône, conversion du modèle en `Menu.buildFromTemplate` |
| `main/main.ts` | Instance unique, cycle de vie, réglages `app.*`, arrêt propre |
| `core/config/schema.ts` | Section `app` : `launchAtStartup`, `startMinimized` |
| `web/admin/fields.ts` | Deux champs et un groupe « Application » dans la vue Paramètres |
| `assets/tray.png` | Icône du tray — placeholder à l’époque, remplacé depuis (voir « Identité visuelle ») |

**Décisions prises pendant ce commit :**

- **La liste blanche de navigation comporte quatre hôtes**, et non les deux annoncés : `id.twitch.tv`, `dev.twitch.tv`, `twitch.tv`, `www.twitch.tv`. L'assistant renvoie vers la console développeur, qui est sur `dev.twitch.tv` ; l'omettre aurait bloqué un lien que l'assistant affiche lui-même.
- **Twitch est renvoyé au navigateur système, jamais rendu dans la fenêtre.** Le flux OAuth passe par le navigateur et le rappel loopback depuis la PR B : la fenêtre n'a aucune raison légitime d'afficher une page Twitch, et montrer une page d'authentification tierce dans une fenêtre applicative est précisément ce qu'on apprend aux utilisateurs à ne pas croire.
- **La comparaison d'hôte est exacte, et le port doit être vide.** Twitch écoute sur 443 ; un port explicite désigne autre chose, quel que soit le nom qui le précède. Le suffixe est refusé par principe — `id.twitch.tv.evil.test` se termine par `twitch.tv` sans rapport avec Twitch — et `hostname` ignore l'identifiant qui précéderait une arobase, qui est l'usurpation la plus lisible.
- **Fermer la fenêtre replie vers le tray, sans réglage possible.** Un compteur de subathon ne doit pas pouvoir être tué par réflexe ; on ne rend pas configurable ce dont la mauvaise valeur coûte le direct. Une notification le dit à la première fermeture, et quitter reste possible par le menu du tray, qui est un geste délibéré.
- **Le tray se rafraîchit toutes les cinq secondes**, et non à chaque changement du compteur : celui-ci change à chaque battement, et reconstruire le menu une fois par seconde ne servirait qu'à fermer celui que l'utilisateur vient d'ouvrir.
- **`app.setName('ChronoCast')` est posé avant toute lecture de chemin.** `app.getPath('userData')` en dérive ; sans lui, les données atterriraient dans un répertoire qui changerait le jour où electron-builder posera `productName`. Un répertoire de données qui se déplace entre deux versions, c'est un compteur perdu.
- **Aucun `await` avant l'enregistrement des écouteurs de cycle de vie.** Le processus principal en ESM se charge de façon asynchrone : une attente placée trop tôt ferait manquer l'événement `ready`. Contrainte réelle d'Electron, à respecter à la lettre.
- **`before-quit` est annulé pour laisser l'arrêt propre se dérouler.** Il est synchrone alors que `application.stop()` ne l'est pas : on l'annule, on arrête sockets, serveur puis journaux, et on sort par `app.exit(0)`.
- **Un échec de démarrage ouvre une `dialog.showErrorBox`.** Dans une application packagée il n'y a pas de console : un port occupé se traduirait sinon par un lancement qui ne fait rien, le pire des retours.
- **La mise en forme de la durée du tray est une redite assumée** de `web/shared/time-format.ts`, et non un partage : ce module-là est compilé pour le navigateur avec sa propre racine, et l'y raccorder ferait entrer du code serveur dans le paquet servi au client. La règle qui compte est la même — tronquer, jamais arrondir au supérieur.
- **Les champs `app.*` n'ont rien exigé du gabarit.** `renderFieldGroups` engendre les champs depuis la table : ajouter la section au schéma a fait passer `fields.test.ts` au rouge tout seul, et le groupe « Application » est apparu sans qu'une ligne de HTML soit écrite.

**L'icône livrée en Phase 6 était un placeholder ;** elle a été remplacée aussitôt après par l'identité visuelle définitive — voir « Identité visuelle » ci-dessous.

**Ce que le conteneur n'a pas vérifié, et qui reste à éprouver sous Windows :** le lancement réel de la fenêtre, le tray et son menu, DPAPI, le lancement au démarrage, l'instance unique, et la notification de premier repli. Trois fichiers, sans logique de décision — c'est le reliquat que le découpage cherchait à réduire.

---

### Identité visuelle — livrée

Deux visuels sources, fournis par l'utilisateur et versionnés : `assets/logo.png` (528 × 529, chronomètre et mot-symbole) et `assets/tray-icon.png` (202 × 223, chronomètre seul). **Ils sont la source de vérité** : les icônes livrées en sont engendrées, et rien n'est retouché à la main.

`scripts/prepare-icons.mjs` produit deux artefacts, eux aussi versionnés :

| Artefact | Emploi |
| --- | --- |
| `assets/tray.png` | Zone de notification. Carré 32 × 32, issu du chronomètre seul — le mot-symbole est illisible sous 32 px |
| `assets/icon.ico` | Application, fenêtre et installeur NSIS. Sept tailles de 16 à 256, issues du logo complet |

**Décisions prises à cette occasion :**

- **Aucune dépendance de traitement d'images.** Le décodage PNG — 8 bits RGBA non entrelacé uniquement, et une erreur franche sinon — tient en une centaine de lignes, et le format ICO n'est qu'un index suivi de PNG concaténés. Une bibliothèque, avec son arbre transitif et souvent ses binaires natifs, élargirait durablement la surface d'un `npm audit` qui a un droit de veto sur chaque PR, pour un travail qu'on refait trois fois dans la vie du projet.
- **Mise au carré par remplissage transparent, jamais par étirement ni recadrage.** Le visuel du tray fait 202 × 223 : l'étirer le déformerait, le recadrer lui couperait une part.
- **L'alpha est prémultiplié avant le rééchantillonnage**, puis retiré. Sans cela, la couleur des pixels transparents — souvent du noir — se mélangerait à celle des pixels visibles et cernerait l'icône d'un halo sombre, d'autant plus visible qu'elle est petite.
- **Les images du `.ico` sont enfermées au format PNG**, ce que Windows accepte depuis Vista. Le format DIB historique imposerait un masque de transparence en plus des pixels, pour un gain nul sur les cibles du projet.
- **La fenêtre reçoit `icon.ico` explicitement.** Une fois l'application packagée, Windows lit l'icône dans l'exécutable ; la poser sert au développement, où elle vaut sinon l'icône par défaut d'Electron — celle qu'on finit par livrer sans s'en apercevoir.
- **`tests/unit/assets/icons.test.ts` vérifie le produit**, pas la source : le tray est carré et transparent, le `.ico` porte exactement les sept tailles, ses entrées sont carrées, ses décalages tombent dans le fichier, et chaque image est bien un PNG. Ce sont des défauts qui ne se voient jamais au moment où on les commet — une icône déformée par Windows, une taille manquante remplacée en silence par une mise à l'échelle floue, un décalage qui déborde et n'échoue qu'au packaging.

### Phase 7 — Packaging et CI — **livrée et éprouvée**

Branches : `chore/packaging-ci` (PR #13) puis `fix/portabilite-windows` (PR #14). **Le workflow `Release` a produit un installeur, qui s'installe et se lance.**

**Le premier build a échoué, et c'est ce qui rend la phase utile.** 33 tests sur 1 476 sont tombés à l'étape `verify` sur le runner Windows, alors que la même suite était verte en conteneur Linux depuis des mois. Aucun n'était une régression : c'étaient des défauts d'origine que seule la plateforme cible pouvait révéler. Le principal — une racine comparée sous une forme non canonique dans `static-handler.ts` — aurait rendu l'application **muette** dès qu'un nom court 8.3, une jonction NTFS ou un `%TEMP%` redirigé s'invitait dans le chemin : ni overlay, ni panneau, ni assistant, un 404 sur tout et un compteur tournant dans le vide. Le second — l'absence de `.gitattributes` — faisait convertir le fichier Open Props vendoré en CRLF au checkout, invalidant son condensat. Les deux sont corrigés, avec un test qui reproduit le premier sous Linux au moyen d'un lien symbolique.

**La leçon, à garder pour la suite du projet :** un `verify` vert en conteneur ne dit rien de Windows. C'est le seul enseignement qu'il faut retenir de cette phase, et il vaut pour la Phase 8 comme pour toute correction future touchant aux chemins ou aux fichiers.

| Livré | Rôle |
| --- | --- |
| `electron-builder.yml` | Cible NSIS Windows x64, `asar`, `files` explicites, installation par utilisateur |
| `.github/workflows/ci.yml` | Lint, typecheck, tests, `npm audit --audit-level=high` bloquant, sur `ubuntu-latest` |
| `.github/workflows/release.yml` | Build sur `windows-latest`, contrôle de cohérence du tag, artefact, GitHub Release |
| `tests/unit/assets/packaging.test.ts` | Cohérence de la configuration — 10 tests |

`electron-builder@26.15.3`, en devDependency, version figée. **234 paquets ajoutés, et `npm audit --audit-level=high` reste à zéro** : c'était le risque à lever avant d'écrire quoi que ce soit.

#### Le build de release ne passe pas par Wine

**Décision prise pendant cette phase.** Le workflow construit sur un runner `windows-latest`, nativement. Le service Docker `build-win` et son image Wine restent un confort local, mais ils ne sont plus le chemin de release et n'ont pas à l'être : GitHub fournit la vraie plateforme, et un build natif est incomparablement plus fiable qu'un build croisé. Cela retire aussi du chemin critique le seul élément que le conteneur n'avait jamais exécuté.

#### Comment produire un `.exe` sans publier de release

Le workflow `Release` a **deux déclencheurs**, et c'est sa principale décision de conception :

| Déclencheur | Effet |
| --- | --- |
| Tag `vX.Y.Z` poussé | Installeur **et** GitHub Release, avec l'installeur et son `.sha256` attachés |
| Manuel (`workflow_dispatch`) | Installeur seul, **rien n'est publié**, artefact téléchargeable 30 jours |

**Marche à suivre pour le mode manuel :** onglet *Actions* du dépôt → workflow *Release* dans la colonne de gauche → bouton *Run workflow* → choisir la branche → *Run workflow*. À la fin de l'exécution, l'installeur et son condensat sont dans la section *Artifacts*, sous `chronocast-windows`.

Sans ce second mode, la seule façon de savoir si le build aboutit serait de créer une release — c'est-à-dire de publier avant d'avoir vérifié, puis de supprimer des tags après coup.

#### Ce qui reste à faire

- **Valider le reste du parcours sur poste Windows.** Sont déjà confirmés : l'installation, le lancement, l'icône de fenêtre, et le service des pages — donc la canonisation de racine tient sur un vrai poste.
- **Restent à vérifier :** l'icône et le menu du tray, le repli de la fenêtre à la fermeture avec sa notification, `%APPDATA%\ChronoCast` et son contenu, le lancement au démarrage, l'instance unique, DPAPI par un flux OAuth complet, **le retour de la fenêtre au premier plan à la fin de ce flux** (section 0), l'overlay collé dans OBS, et la désinstallation qui conserve les données.
- **Décider du sort de `build-win`** une fois la CI éprouvée : le garder comme confort local, ou le retirer avec son image de plusieurs gigaoctets.

---

## 8. Ce qui reste à faire — Phase 8

### Phase 8 — Documentation

Branche suggérée : `docs/documentation-complete`.

Neuf documents dans `docs/` : `ARCHITECTURE.md` (avec diagrammes Mermaid des flux), `DEVELOPER.md`, `USER-GUIDE.md` (avec la procédure SmartScreen), `BUILD.md`, `RELEASE.md`, `SECURITY.md`, `TESTING-TWITCH-CLI.md`, `CRASH-RECOVERY.md`, `OVERLAY-CUSTOMIZATION.md`.

Le `README.md` référence déjà ces documents : les liens sont actuellement morts.

Prévoir aussi `scripts/twitch-mock.sh`, qui pilote le conteneur `twitch-cli` : `twitch event websocket start-server`, l'application pointée dessus via `twitch.eventsubUrl`, puis `twitch event trigger subscribe|subscription-message|subscription-gift|cheer --transport=websocket`.

---

## 9. Modèle de menace — à respecter en Phase 8

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
