# Guide développeur

Ce document explique comment travailler sur ChronoCast : monter l'environnement, écrire du code qui passe, et connaître les règles qui ne se négocient pas.

Lire [ARCHITECTURE.md](ARCHITECTURE.md) d'abord si le découpage du code n'est pas familier.

---

## 1. L'environnement tient en une dépendance : Docker

**Aucun binaire Node n'est installé sur la machine hôte.** Ni Node, ni npm, ni npx, ni CLI tierce. Tout passe par un conteneur, piloté par `./scripts/dc.sh`.

```bash
./scripts/dc.sh install     # npm ci --ignore-scripts
./scripts/dc.sh verify      # lint + typecheck + tests + audit
./scripts/dc.sh help        # toutes les commandes
```

| Commande | Effet |
| --- | --- |
| `install` | Installe les dépendances |
| `lint` | ESLint |
| `typecheck` | Les trois programmes TypeScript : Node, Electron, navigateur |
| `test [motif]` | Vitest, éventuellement filtré |
| `test:watch` | Vitest en continu |
| `audit` | `npm audit --audit-level=high` |
| `verify` | Les quatre précédentes, dans l'ordre |
| `build` | Compilation TypeScript et copie des ressources web |
| `twitch` | Twitch CLI, pour simuler des événements |
| `shell` | Un shell dans le conteneur |
| `npm` | Une commande npm arbitraire |
| `down` | Arrête et nettoie les conteneurs |

**`install` passe `--ignore-scripts`**, ce qui ferme une voie d'attaque classique de la chaîne d'approvisionnement : aucun script post-install de dépendance tierce ne s'exécute. Aucune dépendance de production n'en a besoin.

**Il n'y a pas de commande de packaging local.** L'installeur Windows est construit par la CI, nativement. Voir [BUILD.md](BUILD.md).

## 2. Les règles qui ne se négocient pas

### TDD, sans exception négociable

**Aucune ligne de code de production n'est écrite sans un test qui a d'abord échoué, et dont l'échec a été constaté dans le conteneur.** Pas « écrit », pas « supposé » : constaté, en lisant la sortie rouge.

La seule exemption est le HTML et la CSS **purement présentationnels**, vérifiés à l'œil — et encore : toute logique doit en être extraite dans un module testé. La géométrie du cadre de l'overlay est calculée en TypeScript et testée ; seule la façon de la peindre vit dans la feuille de style.

Ce n'est pas un rituel. Deux fois au moins, un test écrit d'abord a montré que c'était **le test qui se trompait**, pas le code — et cette découverte-là ne se fait pas dans l'autre ordre.

### Le noyau n'importe jamais `electron`

Une règle ESLint le refuse dans `src/core/**`. Toute dépendance à la plateforme passe par un port de `src/core/app/ports.ts`.

Corollaire dans la coquille : **seuls `main/main.ts`, `main/windows.ts` et `main/tray.ts` importent `electron`, et aucun ne décide de rien.** Ces trois fichiers sont nommément exclus de la couverture. Tout ce qui est extractible en est extrait — politique de navigation, magasin de secrets, menu du tray, URL de retour après OAuth — et se teste normalement.

Quand vous ajoutez quelque chose à la coquille, la question à se poser est : *est-ce que ceci décide ?* Si oui, ça n'a rien à faire dans ces trois fichiers.

### Le code navigateur n'importe que des types du noyau

Une règle ESLint l'impose. Les types sont effacés à la compilation ; une valeur, non — et embarquerait du code serveur dans une page.

### L'audit a droit de veto

`npm audit --audit-level=high` est bloquant en CI. Une vulnérabilité haute dans l'arbre arrête la PR, quel qu'en soit le contenu.

### Git

- **Aucune signature dans les messages de commit.** Pas de `Co-Authored-By`, pas de mention d'outil.
- **Jamais de commit sur `main`.** Une branche typée : `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`.
- **Conventional Commits**, avec un corps qui explique le **pourquoi**. Le *quoi* se lit dans le diff.
- Les PR sont fusionnées **en squash**.

## 3. Où va quoi

```
src/
  core/        le noyau, sans electron
    app/       composition, ports, bus applicatif
    counter/   réducteurs purs, barème, service
    twitch/    OAuth, Helix, EventSub, conversion, plan de souscriptions
    server/    HTTP, WebSocket, routes, sécurité
    storage/   écriture atomique, JSON Lines
    config/    schéma Zod
    logging/   journalisation, rédaction des secrets
    events/    vocabulaire du domaine
  main/        coquille Electron
  headless/    point d'entrée Node nu, outil de développement
  web/         overlay, panneau, assistant — servis au navigateur
tests/
  unit/        par module
  integration/ l'application entière, sans réseau
  security/    injection, traversée, CSRF, secrets
```

**Les tests web doivent vivre dans `tests/unit/web/**` ou `tests/security/xss-*.test.ts`.** Ailleurs, ils tournent sans DOM et échouent sans raison apparente : la suite est scindée en deux projets Vitest, `node` et `happy-dom`, et l'appartenance se joue sur le chemin.

## 4. Ajouter un événement Twitch

C'est le point d'extension le mieux balisé de l'application, et il tient en deux endroits :

1. une entrée dans `SUBSCRIPTION_PLAN` (`core/twitch/subscription-plan.ts`) : type, version, portées OAuth exigées, caractère obligatoire ou non, condition ;
2. un cas dans `core/twitch/event-mapper.ts`, qui valide la charge utile par Zod et rend un `DomainEvent`.

Ni le client WebSocket, ni le service compteur, ni l'interface n'ont à changer. Les portées OAuth demandées à l'utilisateur sont **calculées** depuis ce plan : elles suivent d'elles-mêmes.

Pensez à `required` : une souscription facultative qui échoue est signalée sans interrompre la connexion. Un raid qui ne se souscrit pas ne doit pas arrêter le subathon.

## 5. Ajouter un réglage

1. Le déclarer dans `core/config/schema.ts`, **avec sa valeur par défaut et un commentaire disant pourquoi il existe**.
2. Lancer les tests. `tests/unit/web/admin/fields.test.ts` passe au rouge tout seul : chaque feuille du schéma doit être **liée à un champ du panneau ou écartée avec sa raison**.
3. Ajouter le descripteur dans `src/web/admin/fields.ts`. Le gabarit HTML n'est pas à toucher : les champs sont rendus depuis cette table.
4. Si le réglage concerne l'overlay, l'ajouter au type partagé `src/web/shared/protocol.ts` — sans quoi le typecheck casse, ce qui est l'effet recherché.

Ce garde-fou a fonctionné à chaque ajout. Il est là parce qu'un réglage déclaré mais lu nulle part **ment à l'utilisateur** : le cas s'est produit avec un mode WebSocket qui n'avait aucun effet, et il a fallu le retirer.

## 6. Écrire un test qui a sa place ici

Ce que la suite cherche à prouver, dans l'ordre d'importance :

**Le comportement observable, pas l'implémentation.** Un test qui casse au moindre renommage interne coûte plus qu'il ne rapporte.

**La raison d'être en commentaire.** Chaque fichier de test s'ouvre sur ce qu'il défend et pourquoi. Un test dont on ne sait plus ce qu'il protège finit par être supprimé au premier échec gênant.

**Les cas limites qui se sont produits.** Les noms courts 8.3 de Windows, `localhost` qui résout en `::1` avant `127.0.0.1`, un `%APPDATA%` redirigé : ces trois-là ont cassé le produit pour de vrai et ont chacun leur test.

**Jamais de désactivation de règle pour arranger un test.** ESLint interdit le littéral `javascript:` ? On écrit un petit assembleur de schéma plutôt que de désactiver la règle. S'autoriser dans les tests ce qu'on interdit ailleurs, c'est perdre les deux.

## 7. Vérifier avant de proposer une PR

```bash
./scripts/dc.sh verify
```

Doit être **intégralement vert** : lint, les trois typechecks, toute la suite, et l'audit. La CI exécute exactement cela sur `ubuntu-latest`.

Ce que la CI ne peut pas voir : la fenêtre Electron, le tray, DPAPI, l'installeur. Si votre changement les touche, il faut un build Windows et un essai à la main — voir [BUILD.md](BUILD.md).

## 8. Le point d'entrée headless

`npm run build` puis `node dist/headless/index.js` démarre l'application **sans Electron** : serveur, overlay, panneau, tout fonctionne dans un navigateur ordinaire. C'est le moyen le plus rapide de travailler sur le web ou le noyau.

Ses limites sont assumées : le magasin de secrets y est en AES local et non DPAPI, il n'a ni fenêtre ni tray, et sa version est une constante à tenir alignée sur `package.json` à la main. **C'est un outil de développement, pas un livrable.**
