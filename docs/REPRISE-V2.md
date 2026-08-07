# ChronoCast — Document de reprise de la V2

Ce document permet de reprendre le développement depuis une fenêtre de contexte vierge, sans aucune analyse préalable ni question à poser. Il est **vivant** : il est mis à jour à chaque lot, et il fait foi.

**Dernière mise à jour :** 8 août 2026, chantier 3 écrit et vert en conteneur, **non encore éprouvé sur poste Windows**. ChronoCast passe au **Microsoft Store**, seul canal de distribution : plus aucune release GitHub, plus aucun `.exe` publié. **Le chantier 1 — la mise à jour automatique — est retiré**, le Store s'en chargeant. La version passe à **`0.7.0`**.

**La V1 est terminée et publiée.** Son document de reprise, [REPRISE.md](REPRISE.md), est **clos** : il reste l'archive complète des huit phases, de la release `v0.4.0` et de tout ce qui a été décidé en chemin. On y va pour comprendre pourquoi une chose est construite comme elle l'est — les trois pièges du protocole EventSub, les quatre tentatives du cadre de l'overlay, la leçon de la Phase 7. Rien de tout cela n'est répété ici.

---

## 1. Objectif de la V2

La V1 a livré un produit qui fonctionne : un compteur subathon Twitch pour OBS, entièrement local, installé et éprouvé sur un vrai poste Windows. Ce qu'elle a laissé ouvert n'est pas une fonction manquante mais une **boucle manquante** : rien ne relie une version publiée à un poste installé. Un correctif publié ne parvient qu'à qui pense à aller le chercher, c'est-à-dire à personne.

**La V2 ferme cette boucle, et rien d'autre pour l'instant.** Elle n'a pas de programme d'ensemble et n'en cherche pas : la V1 a été planifiée en huit phases parce qu'elle partait de rien. Ce qui vient désormais vient de l'usage, chantier par chantier, chacun décidé avec l'utilisateur avant d'être écrit.

Tout ce qui est acquis — architecture, ports, règles, modèle de menace — reste tel quel. La V2 n'est pas une refonte.

---

## 2. Règles de travail — non négociables

Reprises **à l'identique** de la V1, sans exception : elles ne dépendent pas de la version. Le détail et les raisons sont en section 2 de [REPRISE.md](REPRISE.md).

1. **Aucune signature dans les messages de commit.** Pas de `Co-Authored-By`, pas de mention d'outil ou de modèle.
2. **Toujours du TDD.** Aucune ligne de code de production sans un test écrit d'abord et dont l'échec a été **constaté dans le conteneur**. Seule exemption : le HTML et le CSS purement présentationnels.
3. **Ne jamais committer sans demande explicite** de l'utilisateur.
4. **Après chaque commit, produire un document Markdown de PR** en français, à la racine, nommé `PR-<branche>.md`.
5. **Quand l'utilisateur dit « c'est ok » ou signale la fusion, nettoyer sans qu'il ait à le demander** : document de PR, branche locale (`git branch -D`), artefacts, et mise à jour de ce document.
6. **Toujours vérifier la branche courante avant toute action** : `git branch --show-current` en premier.
7. **Markdown sans word-wrap** dans les documents livrés : un paragraphe tient sur une seule ligne.
8. **Jamais de commit sur `main`.** Branche typée (`feat/`, `fix/`, `chore/`, `docs/`), Conventional Commits avec un corps expliquant le *pourquoi*. C'est l'utilisateur qui crée et fusionne les PR.
9. **Aucun binaire installé sur la machine hôte, hormis Docker.** Tout l'outillage passe par `./scripts/dc.sh`.

---

## 3. Environnement

Inchangé. Voir la section 3 de [REPRISE.md](REPRISE.md) pour le détail, y compris le piège du gitignore global qui exclut `docs/*` et l'exception qui le corrige.

```bash
./scripts/dc.sh install        # npm ci --ignore-scripts
./scripts/dc.sh verify         # lint + les trois typechecks + tests + npm audit
./scripts/dc.sh test [motif]   # Vitest ; le motif filtre les fichiers
./scripts/dc.sh build          # compilation TypeScript + copie des assets web
```

**`dc.sh verify` fait foi**, et non le `verify` de `package.json`, qui n'a pas l'audit.

---

## 4. Décisions actées en V2

Ces décisions ont été validées par l'utilisateur. **Ne pas les rouvrir.** Le tableau s'allonge à chaque chantier.

| Sujet | Décision | Justification |
| --- | --- | --- |
| **Mise à jour automatique** | **Rouverte**, alors que la V1 l'avait exclue | Un compteur subathon tourne pendant des jours chez quelqu'un qui n'ouvre pas GitHub. Sans cette boucle, un correctif publié ne parvient à personne |
| Mécanisme | **Updater maison**, aucune dépendance de production ajoutée | Voir « Pourquoi pas `electron-updater` » ci-dessous |
| Intégrité | **SHA-256** confronté au `.sha256` déjà publié, avant tout lancement | C'est le **seul** contrôle du chemin de mise à jour. Voir section 8 |
| Installation | **Jamais automatique.** Clic explicite, confirmation en deux temps si le compteur tourne | Installer ferme l'application. Un clic distrait pendant un direct coûterait le stream |
| Cadence | Au lancement, différée de 30 s, puis toutes les 6 h | Un subathon dure des jours : une application lancée le lundi ne verrait jamais un correctif publié le mercredi |
| Réglage | **Un seul** : `app.checkForUpdates`, activé par défaut | Chaque réglage de plus est une question de support de plus — le même argument qui a fait retirer le mode `separate` en V1 |
| Source | Constante, jamais configurable | Rendre la source réglable transformerait un réglage en exécution de code arbitraire |
| Signature de code | **Celle du Microsoft Store**, apposée par Microsoft à la certification | Voir le chantier 3. La ligne précédente disait « toujours aucune » : elle n'est plus vraie |
| Plateformes | **Windows seul**, comme la V1 | Linux et macOS restent hors périmètre |
| **Commandes de chat** | Une commande unique, **`!addtime <secondes>`**, plutôt que le catalogue nommé conçu au chantier 2 | Le besoin réel est de créditer une durée qu'aucun barème ne pouvait prévoir. Un catalogue de commandes à durée fixe ne l'aurait pas couvert |
| Qui déclenche | **Modérateurs et diffuseur seuls**, sur le badge porté par la charge utile. Jamais sur le pseudo | Le badge est une donnée que Twitch pose lui-même ; le pseudo est une chaîne qu'on peut imiter |
| Juge des secondes | **Le message**, et non le barème. Le schéma garde le **plafond** | Écart assumé au principe « aucune valeur métier hors du schéma » : voir le chantier 2 ci-dessous |
| Bot de chat tiers | **Aucun.** ChronoCast n'écrit jamais dans le chat, et rien n'annonce la commande aux spectateurs | La bulle de l'overlay est le seul retour visible. Il n'y a donc **aucun réglage à accorder à la main** avec un tiers |
| Portées OAuth | **Aucune nouvelle** | `channel.chat.message` réclame exactement ce que réclame déjà `channel.chat.notification`, active par défaut |
| **Distribution** | **Microsoft Store seul.** Plus aucune release GitHub, plus aucun `.exe` publié | SmartScreen faisait renoncer, des antivirus mettaient l'installeur en quarantaine, et la découvrabilité était nulle. Le Store règle les trois |
| Mise à jour automatique | **Retirée.** Le chantier 1 est supprimé | Un paquet MSIX ne peut pas s'installer un `.exe` par-dessus lui-même. C'est le Store qui met à jour |
| Répertoire de données | **`%USERPROFILE%\ChronoCast`**, hors du conteneur MSIX | Ce que MSIX écrit dans `%APPDATA%` part avec la désinstallation. Un subathon en cours doit y survivre |
| Reprise des données | **Écrite et testée**, décidée sur la présence de `config.json`, copié en dernier | Sans elle, chaque utilisateur déjà installé perdrait compteur, configuration et jetons |
| Lancement au démarrage | **Retiré du schéma.** Extension `windows.startupTask` du manifeste, état détenu par Windows | `setLoginItemSettings` écrit dans un registre virtualisé : la case aurait coché sans que rien ne démarre, **et rien ne l'aurait dit** |
| Soumission au Store | **Manuelle depuis Partner Center.** La CI produit l'artefact | Automatiser demanderait trois secrets Azure AD dans le dépôt : qui en dispose publie sous l'identité du projet |

### Pourquoi pas `electron-updater`

Noté ici pour que le débat ne soit pas rouvert.

- **Environ quarante paquets transitifs** de plus dans un projet qui n'a que `ws` et `zod` en production, et où `npm audit --audit-level=high` a droit de veto sur chaque PR. C'est exactement la logique qui a fait rejeter Vitest 2 en Phase 0 et Tailwind en Phase 5.
- **Sa vérification de signature Authenticode est inopérante ici**, le binaire n'étant pas signé : il n'apporte donc aucune garantie que le `.sha256` ne donne déjà.
- **Son code importe `electron`** et n'est donc pas exécutable en conteneur : il serait hors couverture au moment précis où il décide de lancer un exécutable.
- Il imposerait par-dessus `publish: github` dans electron-builder et un `latest.yml` de plus à chaque release.

L'updater maison tient en quatre modules purs et un port. Toute la décision se vérifie dans le conteneur ; seul `spawn` ne s'y vérifie pas, et il tient en cinq lignes.

---

## 5. État du dépôt

**Branche courante : `chore/version-0.6.0`**, qui porte le passage de version et cette mise à jour. La PR #24 est fusionnée en squash dans `main`.

```
9cc12e9 Commande de chat `!addtime` — créditer du temps depuis le direct (#24)   <- main
a75e0a8 Mise à jour automatique — ChronoCast 0.5.0 (#23)              <- v0.5.0
67d0efb docs: illustrer le README de trois captures du panneau (#22)  <- v0.4.0
```

**1 737 tests, 82 fichiers.** Lint, les trois typechecks et `npm audit --audit-level=high` sans erreur. (1 527 à la fin de la V1, plus les **140** du chantier 1 et les **70** du premier lot du chantier 2.)

**`npm audit` reste à zéro et aucune dépendance n'a été ajoutée** — c'est l'un des arguments de la conception, et il se vérifie mécaniquement.

**La version est en `0.6.0`**, à deux endroits qui doivent rester alignés : [package.json](../package.json) et `APP_VERSION` dans [src/core/app/version.ts](../src/core/app/version.ts). Un test de cohérence les tient ensemble.

**Aucune modification en attente.** `git status` ne doit rien signaler : `dist/`, `release/` et `PR-*.md` sont ignorés.

### Première action à la reprise

```bash
git branch --show-current    # doit afficher main
git pull --ff-only origin main
./scripts/dc.sh verify       # doit être intégralement vert
```

---

## 6. Chantiers

### Chantier 1 — Mise à jour automatique — **livrée et éprouvée**

L'application interroge GitHub au lancement puis toutes les six heures, télécharge la nouvelle version en tâche de fond, vérifie son empreinte, et propose son installation par un bandeau dans le panneau et une entrée dans le menu du tray. **Rien ne s'installe sans un clic délibéré.**

| Fichier | Rôle |
| --- | --- |
| `core/update/semver.ts` | Comparaison de versions. Grammaire étroite : trois nombres, `v` facultatif, rien d'autre |
| `core/update/release-feed.ts` | Charge utile GitHub → candidat validé. Zod, plus le contrôle d'URL |
| `core/update/digest.ts` | Lecture d'un fichier `.sha256` et calcul d'une empreinte |
| `core/update/update-store.ts` | `%APPDATA%\ChronoCast\updates` : écriture et ménage |
| `core/update/update-service.ts` | Machine à états, cadence, téléchargement. Tout injecté |
| `core/update/repository.ts` | Dépôt source, constante et non réglage |
| `core/app/ports.ts` | Nouveau port `UpdateInstaller` |
| `main/update-installer.ts` | `spawn` détaché puis `quit`, les deux injectés — donc testable |
| `web/admin/update-banner.ts` | Modèle pur du bandeau : ce qu'on dit, ce qu'on propose |
| `core/server/routes/api.ts` | `GET /api/update`, `POST /api/update/check`, `POST /api/update/install` |

**Décisions prises pendant ce chantier, à connaître avant d'y toucher :**

- **Rien n'est écrit sur le disque qui n'ait été vérifié.** Les octets sont tenus en mémoire, confrontés au condensat publié, et n'atteignent le disque qu'ensuite. C'est un écart assumé au plan initial, qui prévoyait un fichier `.part` renommé après coup : un installeur non vérifié posé dans `%APPDATA%` serait un exécutable que plus rien n'empêcherait de lancer à la main, et qui se lancerait **sans invite** — voir section 8.
- **Le condensat est téléchargé avant l'installeur.** L'inverse ferait télécharger cent mégaoctets pour découvrir ensuite qu'il n'y a rien à quoi les comparer.
- **L'URL de téléchargement est analysée, jamais comparée par préfixe.** `https://github.com@evil.test/…` commence par la bonne chaîne et ne va pas du tout au bon endroit ; `hostname` ignore l'identifiant qui précède l'arobase. Même discipline que `main/browser-opener.ts`, et pour la même raison. Le chemin est comparé **en entier**, puisqu'il est entièrement déterminé par le dépôt, le tag et le nom de l'asset.
- **On cherche l'asset qui porte le nom attendu, jamais le premier `.exe` venu.** Un artefact étranger déposé sur une release ne doit pas pouvoir se substituer à l'installeur. Le nom se déduit de la version, et [tests/unit/assets/packaging.test.ts](../tests/unit/assets/packaging.test.ts) le tient accordé à l'`artifactName` d'electron-builder — un renommage là-bas rendrait toutes les releases suivantes **invisibles**, sans la moindre erreur.
- **Le `.sha256` doit désigner le bon fichier.** Un condensat parfaitement valide mais portant sur un autre artefact validerait n'importe quel téléchargement.
- **La grammaire de version est étroite, et le refus est le comportement sûr.** Une pré-version, un `tag_name` mal formé, ou une version courante illisible font tous échouer la sélection. Ne pas comprendre sa propre version et mettre à jour quand même reviendrait à accepter n'importe quel artefact. **Conséquence à connaître :** une version portant un suffixe — `0.1.0-test`, `0.5.0-beta` — ne se met jamais à jour. C'est voulu, et cela a fait corriger la version du test d'intégration.
- **`win32.isAbsolute` et non `isAbsolute`** dans `main/update-installer.ts`. Ce dernier suit la convention de la plateforme **hôte** : `C:\...` y passe pour relatif sous Linux, si bien que la garde ne dirait pas la même chose en conteneur et sous Windows. La variante `win32` reconnaît les deux conventions et se comporte identiquement partout. **C'est la leçon de la Phase 7, appliquée d'avance**, et le test l'a attrapée du premier coup.
- **`app.quit` et non `app.exit`** après le lancement de l'installeur : il traverse `before-quit`, donc l'arrêt propre, donc l'écriture du dernier état du compteur. Sortir en force ferait redémarrer la nouvelle version sur un compteur en retard de quelques secondes — au détriment du streamer, ce que le projet refuse partout ailleurs.
- **On ne quitte qu'après avoir lancé, et jamais si le lancement échoue.** L'ordre inverse fermerait l'application sans rien installer, c'est-à-dire arrêterait un subathon pour rien.
- **Le port `UpdateInstaller` est facultatif.** Absent — c'est le cas du point d'entrée headless — le service reste inerte : il n'interroge rien et n'arme aucun minuteur. L'état `unsupported` est distinct de `disabled` parce que le premier est une propriété du point d'entrée et le second un choix de l'utilisateur : les confondre ferait afficher « désactivé » à quelqu'un qui n'a rien désactivé.
- **Le bandeau se tait la plupart du temps.** Il n'apparaît que sur les deux états où l'utilisateur a quelque chose à faire : une version vérifiée qui attend son clic, ou un échec qu'il vaut mieux savoir. Une barre permanente annonçant « vous êtes à jour » n'apprend rien et prend la place de ce qui compterait. **Le téléchargement reste silencieux** : annoncer une version qu'on n'a pas encore vérifiée reviendrait à promettre ce qu'on pourrait devoir retirer.
- **Le bandeau vit dans la coquille du panneau, pas dans une vue**, et dans un élément **distinct de `#banner`** — celui-ci porte les messages transitoires d'enregistrement, et les faire cohabiter effacerait l'annonce au premier réglage modifié.
- **`PROTOCOL_VERSION` reste à 1.** L'ajout du message `update` et du canal du même nom est purement additif, et un overlay ancien resté ouvert dans OBS ne s'abonne pas à ce canal — il ne reçoit donc jamais un message que son union rejetterait. Le cas est traité malgré tout dans `overlay/main.ts` : un message inattendu ne doit jamais casser une page qu'OBS ne rechargera pas.
- **`409` et non `500`** quand l'installation est demandée sans rien de prêt. Il n'y a rien de cassé, il n'y a rien à installer, et un `500` ferait chercher une panne qui n'existe pas.
- **Le répertoire des téléchargements est vidé au démarrage.** Un `.exe` laissé là est celui d'une version déjà installée, et il pèse une centaine de mégaoctets dans le profil de l'utilisateur.
- **Le nettoyage est attendu avant toute écriture, jamais seulement lancé.** C'est un défaut qui a réellement eu lieu : `files.clear()` était appelé en `void`, et un `rm -rf` se terminant après l'écriture effaçait l'installeur qu'on venait de vérifier — le service se déclarait prêt et le fichier n'existait plus. Il s'est manifesté par un test d'intégration rouge sur une exécution chargée, jamais en conteneur au repos. Le réglage est par ailleurs **relu juste avant d'écrire** : décocher la case pendant un téléchargement ne doit pas déposer cent mégaoctets que l'utilisateur vient de refuser. Les deux tests portent sur l'**ordre** des opérations et non sur la survie du fichier, un magasin factice ne terminant son nettoyage que sur demande — observer la survie dépendrait de l'ordonnancement des microtâches, c'est-à-dire d'un test vert quatre-vingt-dix-neuf fois sur cent.

**Deux garde-fous ont fonctionné tout seuls pendant ce chantier**, et c'est ce qu'on leur demande : `fields.test.ts` est passé au rouge dès que `app.checkForUpdates` a rejoint le schéma, tant que le champ du panneau n'existait pas ; et le contrôle d'exhaustivité de TypeScript a signalé `dashboard-model.ts` et `overlay/main.ts` dès que le message `update` a rejoint l'union.

**Un détail vérifié sur le fichier réellement publié, et qui aurait pu coûter cher :** le `.sha256` attaché aux releases est en **mode binaire** — un espace puis une astérisque avant le nom — et non en mode texte. `sha256sum` s'exécute sous Git Bash sur un runner Windows, où c'est le défaut. Les deux formes étaient acceptées par chance autant que par prudence ; le commentaire du code, lui, affirmait l'inverse et a été corrigé.

#### Validation sur poste Windows — faite

**Le parcours complet a été éprouvé par l'utilisateur le 4 août 2026**, selon la méthode décrite en section 7 : un installeur bâti en `0.3.9` depuis une branche jetable, installé sur le poste, y a vu la `0.4.0` publiée, l'a téléchargée, en a vérifié l'empreinte, a affiché le bandeau, et l'a installée sur clic.

**Ce que cela règle :** tout ce que le conteneur ne pouvait pas montrer a tourné pour de vrai — le `spawn` détaché, l'écriture d'une centaine de mégaoctets dans `%APPDATA%`, l'extinction propre, l'assistant NSIS écrasant une installation existante, et la relance. Le pari du chantier se vérifie une fois de plus : la seule pièce non couverte par les tests tenait en cinq lignes, et rien n'a dû y être corrigé après coup.

> **Le chantier 1 a été retiré au chantier 3.** Tout ce qui suit reste vrai de ce qui a été construit, et la section est conservée pour cela : elle explique *pourquoi* le code était fait ainsi, et ce que sa suppression a fait disparaître de la surface d'attaque. `src/core/update/**`, `src/main/update-installer.ts`, le bandeau du panneau et le réglage `app.checkForUpdates` n'existent plus. C'est le Microsoft Store qui met à jour.

### Chantier 2 — Commandes de chat Twitch — **premier lot livré, sous une forme réduite**

Un modérateur ou le diffuseur tape `!addtime 300` dans le chat, et le compteur monte de cinq minutes. Une bulle l'annonce sur l'overlay, l'historique en garde la trace avec le pseudo de son auteur.

**Ce n'est pas le lot 1 conçu dans [CHANTIER-2-COMMANDES-CHAT.md](CHANTIER-2-COMMANDES-CHAT.md), et l'écart est délibéré.** Ce document prévoyait un catalogue de commandes nommées — `!addmort`, `!addpari` — dont les secondes viennent du barème. Le besoin réel s'est révélé autre : créditer une durée qu'aucun barème ne pouvait prévoir. Le catalogue nommé reste possible ; ce lot a construit exactement le pipeline qu'il réutiliserait. **Le reste du document reste valable**, y compris les lots 2 et 3, non décidés.

| Fichier | Rôle |
| --- | --- |
| `core/chat/command-parser.ts` | Syntaxe seule : texte → `{ name, argument }` ou `null`. Ne connaît ni la configuration ni le compteur |
| `core/chat/chatter-badges.ts` | `isPrivileged(badges)`. Douze lignes, testé à part : c'est la porte d'autorisation |
| `core/chat/command-service.ts` | Toutes les décisions : résolution, habilitation, conversion, plafond |
| `core/config/schema.ts` | `twitch.enableChatCommands`, et `rewards.chatCommand.{name, maxSeconds, overlayText}` |
| `core/app/application.ts` | La branche du pipeline, **avant** le convertisseur |
| `core/server/ws-hub.ts` | Joint le libellé de la bulle au message `event` |
| `web/admin/form-binding.ts` | Nouveau `allowEmpty`, seule échappatoire au refus du texte vide |

**Décisions prises pendant ce lot, à connaître avant d'y toucher :**

- **La valeur vient du chat, et le principe « le barème est le seul juge des secondes » est donc amendé.** Ce qui reste juge est le **plafond**, `rewards.chatCommand.maxSeconds`, appliqué **deux fois** : refus dans le service avant même de produire l'événement, écrêtage défensif dans le moteur de barème pour les chemins qui ne passent pas par lui — le bouton de test de l'overlay en est un.
- **Refus au-delà du plafond, jamais écrêtage.** Une valeur démesurée est une faute de frappe bien plus souvent qu'une intention, et créditer une heure à qui en voulait dix obligerait à corriger le compteur à la main, en direct.
- **L'habilitation se lit sur le badge, jamais sur le pseudo.** Aucun appel Helix, aucune portée de modération : `channel.chat.message` transporte déjà l'information.
- **Aucun message n'est écarté sur l'identité de son auteur, et c'est un défaut corrigé en cours de route.** Une première version ignorait les messages du compte authentifié, par crainte d'une boucle avec un bot tiers. Or ce compte est, dans le cas courant, **celui du streamer** : la garde lui refusait sa propre commande sur sa propre chaîne. Les tests ne l'avaient pas vu, Twitch n'y démarrant jamais. **ChronoCast n'écrivant jamais dans le chat, il ne peut produire aucun message susceptible de le redéclencher** : seul le badge décide.
- **La branche se place avant le convertisseur**, et non comme un cas de plus dedans. `channel.chat.message` livre *chaque* message de la chaîne : le faire traverser `mapNotification` puis la déduplication sémantique serait du gaspillage à chaque ligne et remplirait les journaux.
- **La déduplication sémantique ne s'applique pas aux commandes.** Elle reconnaît un même fait de plateforme annoncé par deux flux ; une commande est une intention humaine. Deux `!addtime 300` à trois secondes d'écart sont **deux crédits**. La retransmission par Twitch, elle, reste écartée par le `message_id`.
- **Zéro et les valeurs négatives sont refusés explicitement**, alors même que le périmètre est l'ajout seul. `applyAdd` ignore un delta négatif ou nul **sans rien signaler** : sans ce refus, l'historique dirait l'événement appliqué pendant que le compteur n'aurait pas bougé.
- **La conversion passe par une expression régulière d'entier décimal, et non par `Number()`**, qui accepterait `0x10`, `1e3`, `2.5`, `Infinity` et les chiffres de pleine chasse — autant de valeurs qu'aucun modérateur n'a voulu taper.
- **`U+E0000` est normalisé.** Twitch l'appose aux messages répétés pour contourner sa propre détection de doublon ; sans cela, la **seconde** occurrence d'une commande ne serait jamais reconnue, et la cause serait introuvable à la lecture.
- **Le nom doit être collé au préfixe.** `!  300` nommait autrement une commande « 300 ». Le test l'a attrapé.
- **Le libellé de la bulle voyage dans le message WebSocket**, l'overlay ne recevant que le sous-arbre `overlay` de la configuration alors que ce texte vit dans le barème. Vidé, il est **omis** et non envoyé vide : une chaîne vide ferait réserver la place d'une ligne que rien ne remplirait.
- **`PROTOCOL_VERSION` reste à 1.** Un champ facultatif et un membre d'union de plus sont purement additifs.
- **Un seul interrupteur**, `twitch.enableChatCommands`, éteint par défaut. Il commande la souscription : sans elle aucun message n'arrive, si bien qu'un second réglage côté barème ne pourrait rien éteindre de plus. Un réglage inerte est pire qu'un réglage absent.

**Trois garde-fous ont rougi tout seuls**, et c'est leur raison d'être : `fields.test.ts` dès l'arrivée des réglages au schéma, le contrôle d'exhaustivité de TypeScript sur `semanticKey`, `detailOf`, `buildTestEvent` et `dashboard-model`, et le test d'assignabilité mutuelle des deux protocoles dès l'ajout du libellé.

**Le modèle de menace est inchangé** : aucune écriture sur Twitch, aucune portée nouvelle, aucun trafic sortant nouveau, aucune route ni port de plus.

**Ce lot n'a aucune surface propre à Windows** — ni processus lancé, ni écriture hors du répertoire de données, ni comportement d'installeur. Contrairement au chantier 1, un `verify` vert en conteneur disait ici presque tout.

#### Validation sur une vraie chaîne — faite

**Éprouvée par l'utilisateur le 7 août 2026**, en direct : `!addtime 3600` tapé par le diffuseur crédite bien une heure. Ce que cela règle, et que le conteneur ne pouvait pas montrer : **un vrai modérateur porte bien le badge attendu**, et l'habilitation lue sur la charge utile réelle se comporte comme les fixtures le supposaient.

#### Le piège qui a coûté la première session de test

**Cocher la case ne crée pas la souscription : il faut redémarrer l'application.** Le premier essai n'a rien donné — ni compteur, ni bulle, **ni la moindre ligne de journal**, ce dernier point étant le symptôme qui oriente le diagnostic : un message écarté aurait laissé une trace, zéro trace signifie qu'aucun message n'est jamais arrivé.

La cause est dans [application.ts](../src/core/app/application.ts) : `configService.onChange` rafraîchit le niveau de journalisation, le hub et le service de mise à jour, mais **ne relance jamais le client EventSub**. Les souscriptions ne sont créées qu'au démarrage, par `startTwitch`, et `restartTwitch` n'est appelé qu'à l'issue du flux OAuth.

**Ce n'est pas propre aux commandes** : `twitch.enableRaid` et `twitch.enableFollow` se comportent de la même façon depuis la V1, et personne ne s'en était aperçu — sans doute parce qu'on les active en général avant de lancer un subathon, et non pendant.

**Non corrigé à ce jour.** Deux voies, à trancher : relancer EventSub lorsqu'un réglage *affectant les souscriptions* change — et lui seul, une couleur d'overlay ne doit pas faire tomber la connexion Twitch en plein direct — ou se contenter d'annoncer dans le panneau qu'un redémarrage est nécessaire. La première est la bonne, la seconde coûte une ligne.

### Chantier 3 — Distribution par le Microsoft Store — **écrit, non éprouvé sur poste**

ChronoCast n'est plus distribué que par le Microsoft Store. Le point de départ n'est pas une envie de format : trois symptômes constatés par l'utilisateur. **SmartScreen faisait renoncer des gens** au premier lancement, **des antivirus mettaient l'installeur en quarantaine**, et **la découvrabilité était nulle** — un streamer ne cherche pas un logiciel sur GitHub. Microsoft signe le paquet à la certification, ce qui règle les trois d'un coup, pour ~19 $ une fois et sans abonnement.

**Azure Trusted Signing a été examiné et écarté.** Il aurait réglé SmartScreen et les antivirus sans rien casser — ni MSIX, ni redirection de `%APPDATA%`, ni délai de certification, l'updater intact — mais il n'apporte **rien à la découvrabilité**, qui est le troisième symptôme, et il coûte ~120 $ par an contre ~19 $ une fois.

| Fichier | Rôle |
| --- | --- |
| `core/app/data-migration.ts` | Reprise des données de l'ancienne installation. Le seul module du projet qui puisse détruire quelque chose |
| `core/app/ports.ts` | Nouveau port `SystemSettingsOpener`. `UpdateInstaller` disparaît |
| `core/server/routes/api.ts` | `POST /api/system/startup-settings`. Les trois routes `/api/update` disparaissent |
| `main/system-settings.ts` | `ms-settings:startupapps`, en constante |
| `main/main.ts` | `dataDirectory` passe à `%USERPROFILE%\ChronoCast` ; `legacyDataDirectory` pointe l'ancien |
| `assets/appx/extensions.xml` | Extension `windows.startupTask` du manifeste |
| `assets/appx/*.png` | Sept formats engendrés par `prepare-icons.mjs` |
| `electron-builder.yml` | Cible `appx`, identité Partner Center. Le bloc `nsis` disparaît |
| `.github/workflows/release.yml` | Produit un artefact, ne publie plus rien |
| `docs/PRIVACY.md` | Exigé par la certification |

**Décisions prises pendant ce chantier, à connaître avant d'y toucher :**

- **Les données quittent `%APPDATA%` pour `%USERPROFILE%\ChronoCast`.** MSIX virtualise ce qu'une application packagée écrit dans `%APPDATA%`, dans un conteneur que **la désinstallation emporte**. Y laisser le compteur contredirait la décision « un subathon en cours survit à une réinstallation ». `Documents` a été écarté aussi : fréquemment synchronisé par OneDrive, qui poserait des verrous sur le fichier d'état réécrit chaque seconde.
- **La reprise se décide sur la présence de `config.json`, pas sur la vacuité du répertoire cible.** Un fichier de journal écrit à la milliseconde précédente suffirait à faire conclure qu'il y a déjà une installation. Et `config.json` est **copié en dernier** : sa présence vaut validation, si bien qu'une reprise interrompue n'a pas eu lieu et se rejoue au lancement suivant.
- **La reprise copie, ne déplace jamais, et n'écrase rien.** `COPYFILE_EXCL` fait porter l'exclusion au système de fichiers. Si le passage au Store devait être annulé, la version NSIS retrouverait ses données là où elle les a laissées.
- **La reprise ne lève jamais.** Un échec est décrit dans le journal, et l'application démarre sur une configuration neuve : refuser de se lancer pendant un direct coûte plus cher que redemander une autorisation Twitch.
- **`app.launchAtStartup` est retiré du schéma.** `setLoginItemSettings` écrit dans `HKCU\…\Run`, que MSIX virtualise : la case aurait coché et **rien n'aurait démarré**, sans erreur ni journal. C'est le pire mode de défaillance possible. Le manifeste déclare la tâche, Windows en détient l'état.
- **Le renvoi vers les paramètres passe par un port dédié, pas par `BrowserOpener`.** Ce dernier refuse tout schéma autre que `https:`, et élargir cette garde pour laisser passer `ms-settings:` aurait été une régression. Le nouveau port est **sans paramètre** : aucune adresse ne traverse la frontière.
- **`PROTOCOL_VERSION` passe à 2.** Le canal `update` et son message disparaissent : ce n'est pas additif, et une page ancienne dans une Browser Source OBS doit pouvoir s'en apercevoir.
- **Le refus des identités en attente vit dans le workflow, pas dans la suite.** Un paquet bâti sur une identité marqueuse reste parfaitement utile pour éprouver le packaging par chargement latéral ; il n'est simplement pas soumettable. Le contrôle ne vaut donc que sur un tag. Un test tient le marqueur accordé entre les deux fichiers — et il porte sur les **lignes de valeur**, jamais sur le fichier entier, le marqueur étant cité dans les commentaires qui l'expliquent.
- **La soumission reste manuelle.** L'automatiser demanderait une inscription Azure AD et trois secrets dans le dépôt : qui en dispose publie sous l'identité du projet. Le modèle de menace n'a pas à s'élargir pour économiser un glisser-déposer par version.

**Ce que le retrait de l'updater fait gagner :** la promesse « la seule communication sortante va vers Twitch » **redevient vraie**, et disparaissent avec le code le téléchargement d'un exécutable, sa vérification par condensat, le contrôle d'URL et le lancement d'un processus détaché. Le code qui n'existe plus n'a pas de faille.

**Ce que cela coûte, en connaissance de cause :** tout correctif attend **un à trois jours** de certification, sans retour arrière possible, et les postes sans Store n'ont plus aucun chemin. C'est la raison pour laquelle l'essai en audience privée n'est pas facultatif.

**Cinq garde-fous ont rougi tout seuls**, et c'est leur raison d'être : le compilateur sur `ApiContext` et `ApplicationOptions`, le test d'assignabilité mutuelle des deux protocoles, `fields.test.ts` sur les réglages retirés, `packaging.test.ts` sur la cible et l'identité, et `icons.test.ts` sur les sept formats AppX.

#### Validation sur poste Windows — **à faire**

Rien de ce chantier n'est éprouvé sur Windows, et il touche précisément ce que le conteneur ne peut pas voir. Voir la section 7 et [RELEASE.md](RELEASE.md) § 5.

**Deux incertitudes en particulier, à lever sur poste :**

1. **La lecture de `%APPDATA%\ChronoCast` depuis un paquet MSIX.** La documentation dit que les lectures d'AppData tombent sur le vrai répertoire quand le conteneur n'a rien écrit. Le choix de `%USERPROFILE%` contourne la question **en écriture**, mais la reprise, elle, doit bien **lire** l'ancien emplacement. Si cela ne fonctionne pas, le repli est de lire le chemin non redirigé explicitement.
2. **La tâche de démarrage.** Elle n'existe qu'une fois le paquet installé, et rien avant ne dit qu'elle apparaîtra dans les paramètres.

### Chantiers suivants

Aucun autre n'est décidé. Voir la section 9 pour ce qui a été évoqué sans être tranché.

---

## 7. Ce que le conteneur ne vérifie pas

**Un `verify` vert en conteneur ne dit rien de Windows.** C'est la leçon de la Phase 7 — 33 tests tombés sur le runner Windows alors que la suite était verte en conteneur Linux depuis des mois — et le chantier 3 la rend plus vraie que jamais : il touche l'emplacement des données, le démarrage de session et le format du paquet, c'est-à-dire trois choses qui n'existent qu'une fois installées.

Restent hors de portée de la suite :

- l'ouverture réelle de la fenêtre et son durcissement, l'icône et le menu du tray ;
- DPAPI, donc le chiffrement réel des secrets ;
- **la lecture de `%APPDATA%\ChronoCast` à travers la virtualisation MSIX**, dont dépend toute la reprise des données ;
- **la tâche `windows.startupTask`**, qui n'existe qu'une fois le paquet installé ;
- le paquet lui-même : installation, raccourcis, **désinstallation puis réinstallation**.

### Comment éprouver tout cela sans publier

La route est l'**audience privée** de Partner Center : soumettre le paquet à une audience restreinte à son propre compte, puis l'installer depuis le Store. On éprouve alors exactement ce que recevront les utilisateurs — paquet **réellement signé par Microsoft** — sans installer le SDK Windows ni manipuler de certificat auto-signé. Cela coûte un cycle de certification, et c'est un cycle bien dépensé.

La liste d'essai complète est en section 5 de [RELEASE.md](RELEASE.md). Deux points y comptent plus que les autres :

1. **Installer par-dessus une installation GitHub existante**, et confirmer que le compteur, la configuration et les jetons sont repris. Le journal du panneau le dit explicitement — c'est pour cela qu'il le dit.
2. **Désinstaller, réinstaller, et confirmer que les données sont toujours là.** C'est l'invariant que le choix de `%USERPROFILE%` protège, et le seul moyen de savoir s'il tient.

---

## 8. Modèle de menace — amendements de la V2

Le modèle de la V1 tient intégralement : voir la section 8 de [REPRISE.md](REPRISE.md) et [SECURITY.md](SECURITY.md).

### La promesse « la seule communication sortante va vers Twitch » est rétablie

Le chantier 1 l'avait retirée en ajoutant `api.github.com` et `objects.githubusercontent.com`. **Le chantier 3 la rend de nouveau vraie** : ces deux hôtes disparaissent avec l'updater, et le réglage qui permettait de les couper disparaît avec eux, n'ayant plus d'objet.

Disparaissent également, et ce sont les parties les plus délicates de l'ancien chantier : le téléchargement d'un exécutable par l'application, sa vérification par condensat, le contrôle d'URL qui empêchait une réponse d'API contrefaite d'envoyer le téléchargement ailleurs, et le lancement d'un processus détaché. **Le code qui n'existe plus n'a pas de faille.**

*Ce qui suit reste utile à connaître, parce que c'est le raisonnement qui a justifié la moitié du code retiré :* le fichier téléchargé par le `fetch` de Node ne portait **aucune Mark of the Web** — Windows n'écrit ce flux `Zone.Identifier` que lorsqu'un navigateur ou un client de messagerie dépose le fichier. SmartScreen ne se déclenchait donc **jamais** sur ce que l'application téléchargeait, altéré ou non. La vérification SHA-256 était par conséquent le seul contrôle d'intégrité de ce chemin. Le Store supprime le chemin entier.

### Le conteneur MSIX ajoute deux surfaces à connaître

**La virtualisation de `%APPDATA%`.** Ce qu'une application packagée y écrit va dans un conteneur que la désinstallation emporte. Les données vivent donc hors de là, et la reprise depuis l'ancien emplacement est le seul endroit du code qui lise ce répertoire — en lecture seule, sans jamais écraser quoi que ce soit à destination.

**La virtualisation du registre.** Elle a coûté le réglage `app.launchAtStartup`, dont l'écriture n'atteignait plus rien. Le remplacement passe par un port **sans paramètre** : aucune adresse ne traverse la frontière entre le panneau et la coquille, ce qui aurait transformé un renvoi en capacité d'ouvrir un schéma arbitraire.

### Ce que la signature du Store apporte

Le paquet est signé par Microsoft à la certification. Plus d'avertissement SmartScreen au premier lancement, moins de mises en quarantaine par les antivirus, et une provenance vérifiable qui ne repose plus sur un condensat que personne ne comparait.

---

## 9. Pistes non tranchées

**Rien de ce qui suit n'est décidé.** Cette section existe pour que ces sujets ne soient ni oubliés ni pris pour un plan.

- **Linux et macOS.** Toujours hors périmètre. À noter pour la suite : macOS est hors de portée sans certificat de toute façon, sa mise à jour automatique exigeant signature **et** notarisation — aucune bibliothèque n'y change rien.
- **Purge de l'historique et rotation des journaux sur de très longs subathons.** Évoqué en V1, jamais mesuré.

---

## 10. Documents

| Document | Pour qui |
| --- | --- |
| [REPRISE.md](REPRISE.md) | **Archive de la V1**, close. Les huit phases et toutes leurs décisions |
| [CHANTIER-2-COMMANDES-CHAT.md](CHANTIER-2-COMMANDES-CHAT.md) | Le développeur : conception du chantier 2, arrêtée et non commencée |
| [USER-GUIDE.md](USER-GUIDE.md) | Le streamer : installation, application Twitch, OBS, dépannage |
| [OVERLAY-CUSTOMIZATION.md](OVERLAY-CUSTOMIZATION.md) | Le streamer : réglages d'apparence et `custom.css` |
| [CRASH-RECOVERY.md](CRASH-RECOVERY.md) | Le streamer : ce qu'il perd au pire, et comment le rattraper |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Le développeur : couches, flux, décisions à ne pas rouvrir |
| [DEVELOPER.md](DEVELOPER.md) | Le développeur : environnement, règles, points d'extension |
| [SECURITY.md](SECURITY.md) | Le développeur : modèle de menace et contrôles |
| [PRIVACY.md](PRIVACY.md) | Le streamer, et la certification du Store : ce qui est collecté, et ce qui ne l'est pas |
| [BUILD.md](BUILD.md) | Compilation en conteneur, paquet MSIX en CI |
| [RELEASE.md](RELEASE.md) | Publier une version au Microsoft Store |
| [TESTING-TWITCH-CLI.md](TESTING-TWITCH-CLI.md) | Simuler des événements sans attendre un vrai sub |

**Un garde-fou tient cette liste** : [tests/unit/assets/documentation.test.ts](../tests/unit/assets/documentation.test.ts) vérifie que tout lien relatif mène quelque part et qu'aucun document ne cite une commande que `dc.sh` ne connaît plus.
