# Construire ChronoCast

Deux choses différentes s'appellent « build » ici, et les confondre fait perdre du temps :

- **la compilation** — TypeScript vers JavaScript — se fait en conteneur, en quelques secondes ;
- **le packaging** — le paquet `.appx` destiné au Microsoft Store — se fait **uniquement en CI**, sur un runner Windows.

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

## 2. Packager le paquet MSIX

**Il n'y a pas de commande locale pour ça, et c'est délibéré.**

La cible AppX d'electron-builder réclame `makeappx.exe` et `makepri.exe`, du SDK Windows. Ils n'existent pas dans le conteneur de développement, et n'ont pas à y être : entretenir un second chemin de packaging dont un seul est éprouvé est le plus sûr moyen que celui qu'on n'utilise pas casse en silence. C'est la même raison qui avait fait retirer le service Docker sous Wine après la 0.2.0.

Le paquet se produit donc par le workflow **Release**, de deux façons.

### Sans intention de soumettre — pour éprouver le packaging

Onglet **Actions** du dépôt → workflow **Release** dans la colonne de gauche → bouton **Run workflow** → choisir la branche → **Run workflow**.

À la fin de l'exécution, le `.appx` et le rapport du kit de certification sont dans la section **Artifacts**, sous `chronocast-msix`, téléchargeables pendant trente jours.

C'est le mode à utiliser pour vérifier qu'un changement n'a pas cassé le packaging. Le contrôle d'identité de Partner Center **ne s'applique pas** dans ce mode : un paquet portant une identité en attente reste parfaitement installable par chargement latéral.

### Installer le paquet en local, pour l'éprouver

**Windows refuse d'installer un MSIX non signé** dont le `Publisher` n'appartient pas à « l'espace de noms non signé » — un marqueur qui empêche un paquet non signé de se faire passer pour un éditeur réel. Le nôtre porte l'identité Partner Center : `Add-AppxPackage -AllowUnsigned` échoue donc en `0x80073D2C`, et modifier `publisher` pour contourner casserait la soumission.

Le workflow sait produire un paquet signé pour l'essai. Onglet **Actions** → **Release** → **Run workflow** → cocher **« Signer le paquet avec un certificat auto-signé »**. L'option n'existe qu'en déclenchement manuel : sur un tag, elle est ignorée, ce paquet-là n'étant pas soumettable.

L'artefact contient alors le `.appx` signé **et** `ChronoCast-essai.cer`. Sur le poste d'essai, en administrateur :

```powershell
Import-Certificate -FilePath .\ChronoCast-essai.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
Add-AppxPackage -Path ".\ChronoCast 0.9.0.appx"
```

Le nom du paquet porte une espace : les guillemets ne sont pas optionnels. Pour désinstaller :

```powershell
Get-AppxPackage *ChronoCast* | Remove-AppxPackage
```

Le certificat auto-signé n'est valable que sur ce poste. Il ne change rien à ce que reçoit un utilisateur du Store, dont le paquet est signé par Microsoft — mais **le conteneur MSIX est le même**, et c'est lui qu'on vient éprouver : la reprise des données et la tâche de démarrage se comportent ici exactement comme elles se comporteront là-bas.

### Avec intention de soumettre — voir [RELEASE.md](RELEASE.md)

Un tag `vX.Y.Z` poussé produit le paquet **et** vérifie que l'identité est renseignée. Rien n'est publié pour autant : c'est vous qui déposez le fichier dans Partner Center.

## 3. Ce que fait le workflow

1. `npm ci --ignore-scripts`
2. **Vérification de cohérence du tag** — seulement sur un tag : le tag et `package.json` doivent désigner la même version. Le Store refuse une soumission dont la version ne croît pas, et une divergence rendrait impossible de savoir ce qui est publié.
3. **Vérification de l'identité du paquet** — seulement sur un tag : `identityName`, `publisher` et `publisherDisplayName` ne doivent plus porter le marqueur `IDENTITE-PARTNER-CENTER`. Une identité fausse produit un `.appx` en tout point valide, que **rien ne distingue** d'un paquet soumettable — jusqu'au rejet, un à trois jours plus tard.
4. `npm run verify` — la suite complète. **Un paquet bâti sur une suite rouge n'a aucune raison d'exister.**
5. `npm run build`
6. `npx electron-builder --windows --publish never`
7. **Windows App Certification Kit**, en meilleur effort et jamais bloquant. Son rapport est joint à l'artefact : il se lit avant de soumettre, pas après le rejet.
8. Publication de l'artefact

**L'étape 4 est celle qui échoue le plus souvent**, et c'est une bonne nouvelle : elle tourne sur Windows, là où la CI ordinaire tourne sur Linux. Trois familles de défauts ne se voient que là — les fins de ligne converties par Git, les chemins POSIX écrits en dur, les permissions de fichiers qui n'existent pas sous Windows. Elles ont toutes été rencontrées, et sont couvertes depuis.

## 4. La configuration de packaging

Elle tient dans `electron-builder.yml`, et cinq décisions y sont importantes.

**`productName: ChronoCast` doit rester identique à `app.setName('ChronoCast')`** dans `src/main/main.ts`. C'est de lui que dérive `%APPDATA%\ChronoCast`, **d'où la reprise des données va chercher l'installation précédente**. Les désaccorder ferait chercher dans un répertoire que personne n'a jamais écrit : la reprise ne trouverait rien, et l'utilisateur retrouverait une installation neuve sans le moindre message. **Un test tient les deux ensemble.**

**L'identité du paquet vient de Partner Center**, section « Identité du produit » de la fiche. Elle se recopie au caractère près, casse comprise.

**La liste `files` est explicite.** Ce qui n'y est pas nommé n'entre pas dans le paquet. `assets/**/*` est indispensable et facile à oublier : la coquille y résout l'icône de la fenêtre et celle du tray. Sans ce motif, l'application démarrerait avec l'icône par défaut d'Electron et un tray vide, **sans qu'Electron n'émette le moindre avertissement**.

**`customExtensionsPath` déclare la tâche de démarrage.** Sous MSIX, `app.setLoginItemSettings` écrit dans `HKCU\...\Run`, que le conteneur du paquet **virtualise** : la valeur n'atteint jamais le vrai registre. Sans l'extension `windows.startupTask` du manifeste, rien ne démarrerait avec la session, et **rien ne le dirait**.

**Les ressources graphiques de `assets/appx/` sont engendrées** par `scripts/prepare-icons.mjs`. Sans elles, electron-builder embarque **ses propres images de remplacement**, sans avertissement : le paquet serait accepté, publié, installé — et porterait le logo d'un autre.

## 5. Le paquet est signé par Microsoft

C'est la raison d'être du passage au Store. Un certificat de signature de code coûte 300 à 500 € par an, ce que le projet n'engage pas ; le binaire non signé faisait afficher un avertissement SmartScreen au premier lancement et se faisait mettre en quarantaine par certains antivirus. **Microsoft signe le paquet à la certification**, et l'utilisateur installe depuis le Store.

`forceCodeSigning: false` reste déclaré explicitement : sans cela, une variable d'environnement de certificat traînant sur un runner ferait échouer le build au lieu de produire le paquet non signé qu'attend Partner Center.

## 6. Ce que la CI ne peut pas vérifier

La suite tourne sans Chromium et sans Electron. Restent hors de sa portée :

- l'ouverture réelle de la fenêtre et son durcissement ;
- l'icône et le menu du tray ;
- DPAPI, donc le chiffrement réel des secrets ;
- **la reprise des données depuis `%APPDATA%\ChronoCast`**, dont la logique est testée mais dont la lecture à travers la virtualisation MSIX ne l'est pas ;
- **la tâche de démarrage**, qui n'existe qu'une fois le paquet installé ;
- le paquet lui-même : installation, raccourcis, désinstallation.

Ces points passent par un essai à la main. La route recommandée est l'**audience privée** de Partner Center : soumettre le paquet à une audience restreinte à son propre compte, et l'installer depuis le Store. On éprouve alors exactement ce que recevront les utilisateurs — paquet réellement signé par Microsoft — sans installer le SDK Windows ni manipuler de certificat auto-signé. Cela coûte un cycle de certification.

**Le point le plus important à vérifier est la désinstallation suivie d'une réinstallation** : les données doivent être toujours là. C'est l'invariant que le choix de `%USERPROFILE%\ChronoCast` protège, et le seul moyen de savoir s'il tient.

## 7. Après un build

```bash
rm -rf dist release
```

Les deux répertoires sont ignorés par Git, mais les laisser traîner fausse la lecture d'un `git status` et fait grossir le dépôt local sans raison.
