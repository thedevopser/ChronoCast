# Construire ChronoCast

Deux choses différentes s'appellent « build » ici, et les confondre fait perdre du temps :

- **la compilation** — TypeScript vers JavaScript — se fait en conteneur, en quelques secondes ;
- **le packaging** — l'installeur Windows `.exe` — se fait **uniquement en CI**, sur un runner Windows.

---

## 1. Compiler

```bash
./scripts/dc.sh build
```

Trois choses en une : `tsc` sur le programme Node (`dist/core`, `dist/main`, `dist/headless`), `tsc` sur le programme navigateur (`dist/public`), puis la copie des ressources web — pages, feuilles de style, polices, logo — vers `dist/public`.

Le résultat est exécutable tel quel en headless :

```bash
./scripts/dc.sh npm exec -- node dist/headless/index.js
```

L'application démarre sans Electron : serveur, overlay, panneau, assistant. C'est le moyen le plus rapide de travailler sur le web ou le noyau.

## 2. Packager l'installeur Windows

**Il n'y a pas de commande locale pour ça, et c'est délibéré.**

Un service Docker sous Wine a existé jusqu'à la version 0.2.0. Il pesait plusieurs gigaoctets, construisait **en croisé** ce que GitHub construit nativement, et n'était plus le chemin de release depuis que la CI existe. Le garder aurait voulu dire entretenir deux chemins de packaging dont un seul est éprouvé — le plus sûr moyen que celui qu'on n'utilise pas casse en silence.

L'installeur se produit donc par le workflow **Release**, de deux façons.

### Sans rien publier — pour éprouver le packaging

Onglet **Actions** du dépôt → workflow **Release** dans la colonne de gauche → bouton **Run workflow** → choisir la branche → **Run workflow**.

À la fin de l'exécution, l'installeur et son `.sha256` sont dans la section **Artifacts**, sous `chronocast-windows`, téléchargeables pendant trente jours. **Rien n'est publié.**

C'est le mode à utiliser pour vérifier qu'un changement n'a pas cassé le packaging. Sans lui, la seule façon de le savoir serait de créer une release — c'est-à-dire de publier avant d'avoir vérifié.

### Avec publication — voir [RELEASE.md](RELEASE.md)

Un tag `vX.Y.Z` poussé produit l'installeur **et** crée la GitHub Release.

## 3. Ce que fait le workflow

1. `npm ci --ignore-scripts`
2. **Vérification de cohérence du tag** — seulement sur un tag : le tag et `package.json` doivent désigner la même version, sans quoi le build échoue. Une release `v1.2.0` contenant un `ChronoCast-Setup-1.1.0.exe` rendrait impossible de savoir quelle version est installée.
3. `npm run verify` — la suite complète. **Un installeur bâti sur une suite rouge n'a aucune raison d'exister.**
4. `npm run build`
5. `npx electron-builder --windows --publish never`
6. Calcul du SHA-256
7. Publication de l'artefact, et de la release si c'est un tag

**L'étape 3 est celle qui échoue le plus souvent**, et c'est une bonne nouvelle : elle tourne sur Windows, là où la CI ordinaire tourne sur Linux. Trois familles de défauts ne se voient que là — les fins de ligne converties par Git, les chemins POSIX écrits en dur, les permissions de fichiers qui n'existent pas sous Windows. Elles ont toutes été rencontrées, et sont couvertes depuis.

## 4. La configuration de packaging

Elle tient dans `electron-builder.yml`, et quatre décisions y sont importantes.

**`productName: ChronoCast` doit rester identique à `app.setName('ChronoCast')`** dans `src/main/main.ts`. C'est de lui que dérive `%APPDATA%\ChronoCast`, où vivent la configuration, l'état du compteur et les jetons. Les désaccorder déplacerait le répertoire de données d'une version à l'autre — autrement dit, perdrait un subathon en cours sans le moindre message. **Un test tient les deux ensemble.**

**La liste `files` est explicite.** Ce qui n'y est pas nommé n'entre pas dans le paquet. `assets/**/*` est indispensable et facile à oublier : la coquille y résout l'icône de la fenêtre et celle du tray. Sans ce motif, l'application démarrerait avec l'icône par défaut d'Electron et un tray vide, **sans qu'Electron n'émette le moindre avertissement**.

**Installation par utilisateur** (`perMachine: false`), sans élévation. L'application n'écrit que dans `%APPDATA%`, `safeStorage` lie de toute façon les secrets au compte Windows, et une invite UAC sur un binaire non signé est le meilleur moyen de faire renoncer quelqu'un.

**`deleteAppDataOnUninstall: false`.** Les données de l'utilisateur ne sont jamais effacées par la désinstallation : un subathon en cours doit survivre à une réinstallation, et c'est précisément ce qu'on fait quand quelque chose ne va pas.

## 5. Le binaire n'est pas signé

Un certificat de signature de code coûte 300 à 500 € par an. Le projet ne l'engage pas.

Conséquence : **SmartScreen affiche un avertissement au premier lancement.** La parade est le condensat SHA-256, publié avec chaque release, qui permet à l'utilisateur de vérifier que le fichier téléchargé est bien celui produit par la CI. Le workflow le calcule et l'attache automatiquement.

`forceCodeSigning: false` est déclaré explicitement dans la configuration : sans cela, une variable d'environnement de certificat traînant sur un runner ferait échouer le build au lieu de produire un binaire non signé, comme prévu.

## 6. Ce que la CI ne peut pas vérifier

La suite tourne sans Chromium et sans Electron. Restent hors de sa portée :

- l'ouverture réelle de la fenêtre et son durcissement ;
- l'icône et le menu du tray ;
- DPAPI, donc le chiffrement réel des secrets ;
- le lancement au démarrage de session et l'instance unique ;
- l'installeur lui-même : installation, raccourcis, désinstallation.

Ces points passent par un essai à la main, après un build. Ils ont tous été validés sur poste Windows au moment de la version 0.2.0, et **rien n'a dû être corrigé dans les trois fichiers qui importent `electron`** — ce qui était le pari de leur conception.

Si votre changement touche l'un d'eux, prévoyez un build manuel et un essai avant de proposer la PR.

## 7. Après un build

```bash
rm -rf dist release
```

Les deux répertoires sont ignorés par Git, mais les laisser traîner fausse la lecture d'un `git status` et fait grossir le dépôt local sans raison.
