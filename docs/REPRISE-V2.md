# ChronoCast — Document de reprise de la V2

Ce document permet de reprendre le développement depuis une fenêtre de contexte vierge, sans aucune analyse préalable ni question à poser. Il est **vivant** : il est mis à jour à chaque lot, et il fait foi.

**Dernière mise à jour :** 4 août 2026, sur la branche `feat/auto-update`. Le chantier 1 — la mise à jour automatique — est **livré et éprouvé sur un vrai poste Windows**. La version est en **`0.5.0`**, prête à être publiée.

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
| Signature de code | **Toujours aucune** | Non tranché pour la suite : voir section 9 |
| Plateformes | **Windows seul**, comme la V1 | Linux et macOS restent hors périmètre |

### Pourquoi pas `electron-updater`

Noté ici pour que le débat ne soit pas rouvert.

- **Environ quarante paquets transitifs** de plus dans un projet qui n'a que `ws` et `zod` en production, et où `npm audit --audit-level=high` a droit de veto sur chaque PR. C'est exactement la logique qui a fait rejeter Vitest 2 en Phase 0 et Tailwind en Phase 5.
- **Sa vérification de signature Authenticode est inopérante ici**, le binaire n'étant pas signé : il n'apporte donc aucune garantie que le `.sha256` ne donne déjà.
- **Son code importe `electron`** et n'est donc pas exécutable en conteneur : il serait hors couverture au moment précis où il décide de lancer un exécutable.
- Il imposerait par-dessus `publish: github` dans electron-builder et un `latest.yml` de plus à chaque release.

L'updater maison tient en quatre modules purs et un port. Toute la décision se vérifie dans le conteneur ; seul `spawn` ne s'y vérifie pas, et il tient en cinq lignes.

---

## 5. État du dépôt

**Branche courante : `feat/auto-update`.** Le chantier 1 y est écrit en quatre commits. `main` est sur `67d0efb`, tag `v0.4.0`.

**1 665 tests, 79 fichiers.** Lint, les trois typechecks et `npm audit --audit-level=high` sans erreur. (1 527 à la fin de la V1, plus les **138** du chantier 1.)

**`npm audit` reste à zéro et aucune dépendance n'a été ajoutée** — c'est l'un des arguments de la conception, et il se vérifie mécaniquement.

**La version est en `0.5.0`**, à deux endroits qui doivent rester alignés : [package.json](../package.json) et `APP_VERSION` dans [src/core/app/version.ts](../src/core/app/version.ts). Un test de cohérence les tient ensemble.

### Première action à la reprise

```bash
git branch --show-current
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

**Deux garde-fous ont fonctionné tout seuls pendant ce chantier**, et c'est ce qu'on leur demande : `fields.test.ts` est passé au rouge dès que `app.checkForUpdates` a rejoint le schéma, tant que le champ du panneau n'existait pas ; et le contrôle d'exhaustivité de TypeScript a signalé `dashboard-model.ts` et `overlay/main.ts` dès que le message `update` a rejoint l'union.

**Un détail vérifié sur le fichier réellement publié, et qui aurait pu coûter cher :** le `.sha256` attaché aux releases est en **mode binaire** — un espace puis une astérisque avant le nom — et non en mode texte. `sha256sum` s'exécute sous Git Bash sur un runner Windows, où c'est le défaut. Les deux formes étaient acceptées par chance autant que par prudence ; le commentaire du code, lui, affirmait l'inverse et a été corrigé.

#### Validation sur poste Windows — faite

**Le parcours complet a été éprouvé par l'utilisateur le 4 août 2026**, selon la méthode décrite en section 7 : un installeur bâti en `0.3.9` depuis une branche jetable, installé sur le poste, y a vu la `0.4.0` publiée, l'a téléchargée, en a vérifié l'empreinte, a affiché le bandeau, et l'a installée sur clic.

**Ce que cela règle :** tout ce que le conteneur ne pouvait pas montrer a tourné pour de vrai — le `spawn` détaché, l'écriture d'une centaine de mégaoctets dans `%APPDATA%`, l'extinction propre, l'assistant NSIS écrasant une installation existante, et la relance. Le pari du chantier se vérifie une fois de plus : la seule pièce non couverte par les tests tenait en cinq lignes, et rien n'a dû y être corrigé après coup.

### Chantiers suivants

Aucun n'est décidé. Voir la section 9 pour ce qui a été évoqué sans être tranché.

---

## 7. Ce que le conteneur ne vérifie pas

**Un `verify` vert en conteneur ne dit rien de Windows.** C'est la leçon de la Phase 7 — 33 tests tombés sur le runner Windows alors que la suite était verte en conteneur Linux depuis des mois — et le chantier 1 l'élargit. **Il a été éprouvé sur poste et rien n'a dû être corrigé**, mais la méthode reste ici parce qu'elle resservira au chantier suivant :

- il **lance un processus** : `spawn` détaché, `unref`, puis extinction. Rien de tout cela ne s'observe ici ;
- il **écrit dans `%APPDATA%`** un fichier d'une centaine de mégaoctets, puis le rend exécutable par Windows ;
- il dépend de la façon dont **l'installeur NSIS se comporte quand il écrase une installation existante**, et de `runAfterFinish`, qui relance l'application.

### Comment éprouver la mise à jour sous Windows sans rien publier

Le parcours complet se teste en s'appuyant sur la release `v0.4.0`, déjà en ligne :

1. Poser temporairement `0.3.9` dans [package.json](../package.json) **et** dans [version.ts](../src/core/app/version.ts) — les deux ensemble, le test de cohérence y veille.
2. Déclencher le workflow `Release` en mode manuel (*Actions* → *Release* → *Run workflow*) : il produit `ChronoCast-Setup-0.3.9.exe` sans rien publier.
3. L'installer. L'application se croit en `0.3.9`, voit la `0.4.0` sur GitHub, la télécharge, vérifie son empreinte et propose son installation.
4. Observer : le bandeau du panneau, l'entrée du tray, la confirmation en deux temps quand le compteur tourne, la fermeture propre, l'assistant NSIS, la relance, et surtout **le temps restant du compteur, identique avant et après**.
5. Vérifier que `%APPDATA%\ChronoCast\updates\` est vide au lancement suivant.
6. Revenir à la vraie version dans les deux fichiers.

Un test de plus, à ne pas oublier parce qu'il ne se voit pas : **décocher le réglage et confirmer qu'aucune requête ne part**. Le journal du panneau le dit.

---

## 8. Modèle de menace — amendements de la V2

Le modèle de la V1 tient intégralement : voir la section 8 de [REPRISE.md](REPRISE.md) et [SECURITY.md](SECURITY.md). La V2 y ajoute deux choses, et retire une promesse.

### La promesse « la seule communication sortante va vers Twitch » n'est plus vraie

`api.github.com` et `objects.githubusercontent.com` s'y ajoutent, en HTTPS, **sans jeton ni identifiant** — l'API publique des releases ne demande rien, et n'apprend donc rien de l'utilisateur au-delà de son adresse IP et de la version qu'il exécute, portée par le `User-Agent`. Quatre requêtes par jour. Le réglage `app.checkForUpdates` coupe entièrement ce trafic.

### SmartScreen ne protège pas le chemin de mise à jour

C'est le point le plus contre-intuitif du chantier, et la raison d'être de la moitié de son code.

L'installeur **n'est pas signé** : `forceCodeSigning: false`, aucun certificat, `signtool` jamais appelé. Mais surtout, **le fichier téléchargé par le `fetch` de Node ne porte aucune *Mark of the Web*** — Windows n'écrit ce flux alternatif `Zone.Identifier` que lorsqu'un navigateur ou un client de messagerie dépose le fichier. SmartScreen ne se déclenchera donc **jamais** sur ce que l'application télécharge, altéré ou non.

**La vérification SHA-256 est par conséquent le seul contrôle d'intégrité de ce chemin.** Elle n'est pas négociable, et elle est doublée par le contrôle d'URL, qui empêche une réponse d'API contrefaite d'envoyer le téléchargement ailleurs. Faire reposer toute la sécurité sur un contrôle unique, c'est n'en avoir aucun le jour où il se révèle faux.

*À toutes fins utiles :* l'absence d'invite SmartScreen au lancement manuel d'un installeur téléchargé depuis la page des releases ne prouve pas qu'il est signé. Elle s'explique par une vérification par réputation désactivée dans Sécurité Windows, un antivirus tiers ayant repris la main sur Defender, ou une marque perdue — elle ne survit ni à un volume exFAT, ni à une extraction 7-Zip.

---

## 9. Pistes non tranchées

**Rien de ce qui suit n'est décidé.** Cette section existe pour que ces sujets ne soient ni oubliés ni pris pour un plan.

- **Signature de code.** Un certificat OV classique coûte 300 à 500 € par an, ce qui l'avait fait écarter en V1. **Azure Trusted Signing** est à environ 10 $ par mois et accepte désormais les personnes physiques. Cela ferait disparaître l'avertissement SmartScreen au premier lancement, et rendrait possible une vérification de signature sur le chemin de mise à jour, en plus du condensat. Non évalué, non chiffré, non décidé.
- **Linux et macOS.** Toujours hors périmètre. À noter pour la suite : macOS est hors de portée sans certificat de toute façon, sa mise à jour automatique exigeant signature **et** notarisation — aucune bibliothèque n'y change rien.
- **Notes de version dans le bandeau.** Le lien vers la page de la release est posé ; afficher le corps des notes demanderait de rendre du Markdown venu du réseau dans une page à CSP stricte. Ce n'est pas un petit sujet.
- **Purge de l'historique et rotation des journaux sur de très longs subathons.** Évoqué en V1, jamais mesuré.

---

## 10. Documents

| Document | Pour qui |
| --- | --- |
| [REPRISE.md](REPRISE.md) | **Archive de la V1**, close. Les huit phases et toutes leurs décisions |
| [USER-GUIDE.md](USER-GUIDE.md) | Le streamer : installation, application Twitch, OBS, dépannage |
| [OVERLAY-CUSTOMIZATION.md](OVERLAY-CUSTOMIZATION.md) | Le streamer : réglages d'apparence et `custom.css` |
| [CRASH-RECOVERY.md](CRASH-RECOVERY.md) | Le streamer : ce qu'il perd au pire, et comment le rattraper |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Le développeur : couches, flux, décisions à ne pas rouvrir |
| [DEVELOPER.md](DEVELOPER.md) | Le développeur : environnement, règles, points d'extension |
| [SECURITY.md](SECURITY.md) | Le développeur : modèle de menace et contrôles |
| [BUILD.md](BUILD.md) | Compilation en conteneur, packaging en CI |
| [RELEASE.md](RELEASE.md) | Publier une version |
| [TESTING-TWITCH-CLI.md](TESTING-TWITCH-CLI.md) | Simuler des événements sans attendre un vrai sub |

**Un garde-fou tient cette liste** : [tests/unit/assets/documentation.test.ts](../tests/unit/assets/documentation.test.ts) vérifie que tout lien relatif mène quelque part et qu'aucun document ne cite une commande que `dc.sh` ne connaît plus.
