# Publier une version

Une release ChronoCast, c'est un tag poussé. Tout le reste — vérification, compilation, installeur, condensat, page de release — est fait par le workflow **Release**.

---

## 1. Avant de taguer

**La version vit à deux endroits, et ils doivent être alignés :**

| Fichier | Rôle |
| --- | --- |
| `package.json` | Nom de l'installeur produit, et ce que rend `app.getVersion()` |
| `src/core/app/version.ts` | Constante `APP_VERSION`, le noyau n'ayant pas accès au premier — sa disposition change au packaging |

**Cet alignement est tenu par un test** : [tests/unit/assets/packaging.test.ts](../tests/unit/assets/packaging.test.ts) compare les deux valeurs et refuse de passer si l'une des deux a été oubliée. Il vérifie aussi que la version reste sémantique, `x.y.z` sans suffixe — une pré-version ne se met jamais à jour toute seule, la grammaire de l'updater la refusant délibérément.

**Le tag et `package.json` doivent désigner la même version.** Là, en revanche, le workflow vérifie et **échoue** si ce n'est pas le cas. Une release `v1.2.0` contenant un `ChronoCast-Setup-1.1.0.exe` rendrait impossible de savoir ce qui est installé.

**La suite doit être verte** :

```bash
./scripts/dc.sh verify
```

Le workflow la relance de toute façon, sur Windows. Autant le savoir avant.

**Le packaging devrait avoir été éprouvé** par un déclenchement manuel du workflow, surtout si le changement touche la coquille, les icônes ou la configuration de packaging. Voir [BUILD.md](BUILD.md).

## 2. Publier

```bash
git checkout main
git pull --ff-only origin main
git tag v0.3.0
git push origin v0.3.0
```

Le workflow démarre seul. À la fin, la page des releases porte :

- `ChronoCast-Setup-0.3.0.exe`
- `ChronoCast-Setup-0.3.0.exe.sha256`
- des notes de version engendrées depuis les commits, précédées de la marche à suivre SmartScreen

## 3. Numéroter

Versionnage sémantique, lu du point de vue du streamer :

| Incrément | Quand |
| --- | --- |
| **Majeure** | Une configuration existante ne fonctionne plus telle quelle |
| **Mineure** | Une fonctionnalité s'ajoute, l'existant est préservé |
| **Corrective** | Correction seule |

Tant que la V1 n'est pas atteinte, la numérotation reste en `0.x` : la mineure porte les fonctionnalités, la corrective les correctifs.

**Une configuration existante doit continuer de fonctionner.** Le schéma est en mode `strip` et chaque champ porte une valeur par défaut : ajouter un réglage ou en retirer un ne demande aucune migration, et la version majeure n'a donc pas à bouger pour ça. Elle bougera le jour où un réglage changera de *sens*.

## 4. Si le workflow échoue

**Sur la vérification du tag** — le tag et `package.json` divergent. Corrigez `package.json` sur `main`, supprimez le tag, retaguez :

```bash
git tag -d v0.3.0
git push origin :refs/tags/v0.3.0
```

**Sur `npm run verify`** — la suite passe sous Linux mais casse sous Windows. C'est le cas de figure classique, et il a trois causes connues : des fins de ligne converties par Git qui invalident une empreinte, un chemin POSIX écrit en dur, une permission de fichier qui n'existe pas sous Windows. Corrigez sur une branche, fusionnez, retaguez.

**Sur la construction de l'installeur** — presque toujours la configuration de packaging. Reproduisez par un déclenchement manuel du workflow, qui ne publie rien, plutôt qu'en enchaînant les tags.

**Dans tous les cas, un tag supprimé et repoussé est acceptable tant que la release n'existe pas.** Une fois la release publiée, on ne la réécrit pas : on publie une corrective. Des gens l'auront déjà téléchargée.

## 5. Après publication

**Essayez l'installeur vous-même**, depuis la page de release et non depuis l'artefact du build : c'est le seul moyen de vérifier que ce que l'utilisateur télécharge est bien ce que vous croyez.

Le parcours minimal : installation, lancement, vérification de la version affichée dans le panneau, overlay dans OBS.

**Une mise à jour se pose par-dessus l'installation existante** et conserve `%APPDATA%\ChronoCast` : configuration, compteur et jetons survivent. Il n'y a pas de mise à jour automatique — c'est l'utilisateur qui télécharge.

## 6. Ce qui n'est pas automatisé, et pourquoi

**Aucun changelog tenu à la main.** Les notes sont engendrées depuis les commits. C'est la raison pour laquelle les messages de commit portent le *pourquoi* et non le *quoi* : ils sont lus par des gens, dans la page de release.

**Aucune publication automatique depuis le build** (`publish: null` dans la configuration d'electron-builder). C'est le workflow qui attache les fichiers, après avoir vérifié la cohérence du tag. Un electron-builder qui publierait lui-même contournerait cette vérification.

**Aucune signature de code.** Voir [BUILD.md](BUILD.md) : le condensat SHA-256 en tient lieu.
