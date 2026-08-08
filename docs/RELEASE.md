# Publier une version

Une release ChronoCast, c'est un tag poussé **et un dépôt manuel dans Partner Center**. Le workflow **Release** fait tout le reste — vérification, compilation, paquet, kit de certification — mais il ne publie rien.

C'est délibéré. Automatiser la soumission demanderait une inscription d'application Azure AD et trois secrets dans le dépôt : qui en dispose publie sous l'identité du projet. Le modèle de menace de [SECURITY.md](SECURITY.md) n'a pas à s'élargir pour économiser un glisser-déposer par version.

---

## 1. Avant de taguer

**La version vit à deux endroits, et ils doivent être alignés :**

| Fichier | Rôle |
| --- | --- |
| `package.json` | Version du paquet MSIX, et ce que rend `app.getVersion()` |
| `src/core/app/version.ts` | Constante `APP_VERSION`, le noyau n'ayant pas accès au premier — sa disposition change au packaging |

**Cet alignement est tenu par un test** : [tests/unit/assets/packaging.test.ts](../tests/unit/assets/packaging.test.ts) compare les deux valeurs et refuse de passer si l'une des deux a été oubliée. Il vérifie aussi que la version reste sémantique, `x.y.z` sans suffixe.

**Le tag et `package.json` doivent désigner la même version.** Là, le workflow vérifie et **échoue** si ce n'est pas le cas. Le Store refuse par ailleurs une soumission dont la version ne croît pas : une divergence se paierait au dépôt suivant.

**L'identité du paquet doit être renseignée.** Le workflow le vérifie aussi, et seulement sur un tag. Voir [BUILD.md](BUILD.md).

**La suite doit être verte** :

```bash
./scripts/dc.sh verify
```

Le workflow la relance de toute façon, sur Windows. Autant le savoir avant.

**Le packaging devrait avoir été éprouvé** par un déclenchement manuel du workflow, surtout si le changement touche la coquille, les icônes ou la configuration de packaging. Voir [BUILD.md](BUILD.md).

## 2. Produire le paquet

```bash
git checkout main
git pull --ff-only origin main
git tag v0.8.0
git push origin v0.8.0
```

Le workflow démarre seul. À la fin, l'artefact `chronocast-msix` de l'exécution porte :

- `ChronoCast-0.8.0-x64.appx`
- `wack-report.xml`, le rapport du kit de certification

**Lisez le rapport avant de déposer.** Il attrape une bonne part des motifs de rejet, et le lire coûte deux minutes là où un rejet coûte un à trois jours.

## 3. Déposer dans Partner Center

1. Partner Center → **ChronoCast** → **Nouvelle soumission**.
2. **Packages** : déposer le `.appx`. Partner Center l'accepte tel quel — le `.msixupload` est un format propre à Visual Studio, il n'y a pas à le produire.
3. **Tarification et disponibilité** : gratuit, marchés voulus. Pour un premier essai, **audience privée** restreinte à votre propre compte : voir la section 5.
4. **Propriétés** : catégorie, politique de confidentialité ([PRIVACY.md](PRIVACY.md)), contact de support.
5. **Classification par âge** : questionnaire IARC.
6. **Description du Store** : texte, captures. Celles de [images/](images/) conviennent.
7. **Soumettre au Store.**

**Les textes à coller sont dans [STORE-SUBMISSION.md](STORE-SUBMISSION.md)** : justification de `runFullTrust`, notes aux testeurs, description, et le reste du formulaire.

Comptez **un à trois jours** de certification. C'est le coût du canal, et il ne se contourne pas : prévoyez-le avant de publier un correctif attendu.

## 4. Numéroter

Versionnage sémantique, lu du point de vue du streamer :

| Incrément | Quand |
| --- | --- |
| **Majeure** | Une configuration existante ne fonctionne plus telle quelle |
| **Mineure** | Une fonctionnalité s'ajoute, l'existant est préservé |
| **Corrective** | Correction seule |

Tant que la V1 n'est pas atteinte, la numérotation reste en `0.x` : la mineure porte les fonctionnalités, la corrective les correctifs.

**Une configuration existante doit continuer de fonctionner.** Le schéma est en mode `strip` et chaque champ porte une valeur par défaut : ajouter un réglage ou en retirer un ne demande aucune migration.

## 5. La première soumission passe par une audience privée

**Rien de ce qui suit ne se vérifie en conteneur**, et la leçon de la Phase 7 vaut ici plus qu'ailleurs.

Une audience privée donne le paquet **réellement signé par Microsoft**, installé depuis le Store, visible de vous seul. C'est le seul moyen d'éprouver ce que recevront les utilisateurs sans installer le SDK Windows ni manipuler de certificat auto-signé. Cela coûte un cycle de certification, et c'est un cycle bien dépensé.

Liste d'essai, dans l'ordre :

1. **Installer par-dessus une installation GitHub existante** et confirmer que compteur, configuration et jetons sont repris depuis `%APPDATA%\ChronoCast`. Le journal du panneau le dit explicitement.
2. Fenêtre, icône, menu du tray, repli sur la croix.
3. OAuth Twitch complet, puis un événement simulé qui crédite du temps.
4. Overlay dans OBS sur `127.0.0.1`, et `!addtime` depuis le chat.
5. ChronoCast **apparaît dans Paramètres → Applications → Démarrage** ; l'activer, ouvrir une session, vérifier le lancement.
6. **Désinstaller, réinstaller, et confirmer que les données sont toujours là.** C'est l'invariant que le choix de `%USERPROFILE%\ChronoCast` protège.
7. Vérifier qu'aucune requête ne part vers `api.github.com`.

## 6. Si le workflow échoue

**Sur la vérification du tag** — le tag et `package.json` divergent. Corrigez `package.json` sur `main`, supprimez le tag, retaguez :

```bash
git tag -d v0.8.0
git push origin :refs/tags/v0.8.0
```

**Sur la vérification de l'identité** — `electron-builder.yml` porte encore le marqueur `IDENTITE-PARTNER-CENTER` sur une ligne de valeur. Relevez les trois valeurs dans Partner Center → Identité du produit.

**Sur `npm run verify`** — la suite passe sous Linux mais casse sous Windows. C'est le cas de figure classique, et il a trois causes connues : des fins de ligne converties par Git qui invalident une empreinte, un chemin POSIX écrit en dur, une permission de fichier qui n'existe pas sous Windows.

**Sur la construction du paquet** — presque toujours la configuration de packaging. Reproduisez par un déclenchement manuel du workflow plutôt qu'en enchaînant les tags.

**Un tag supprimé et repoussé est acceptable tant que rien n'est soumis.** Une fois la soumission déposée, on ne la réécrit pas : on publie une corrective.

## 7. Si la certification rejette

Le rejet du premier tour est **probable**, et il n'a rien d'inquiétant. Motifs fréquents : ressources graphiques incomplètes, politique de confidentialité absente ou hors sujet, capture d'écran non conforme, description mentionnant une marque tierce comme une affiliation.

**La marque Twitch se décrit comme une interopérabilité, jamais comme une affiliation.** ChronoCast fonctionne *avec* Twitch ; il n'en émane pas.

Partner Center détaille le motif. Corrigez, redéposez : une nouvelle soumission ne demande pas de nouveau tag tant que le paquet n'a pas changé.

## 8. Ce qui n'est pas automatisé, et pourquoi

**Aucun changelog tenu à la main.** Les notes de version du Store se rédigent dans la soumission, depuis les commits. C'est la raison pour laquelle les messages de commit portent le *pourquoi* et non le *quoi*.

**Aucune soumission automatique.** Voir l'introduction.

**Aucune signature de code du projet.** C'est le Store qui signe. Voir [BUILD.md](BUILD.md).
