# Tester avec la Twitch CLI

Attendre qu'un vrai spectateur s'abonne pour vérifier que le compteur s'incrémente n'est pas une méthode de travail. La Twitch CLI fournit un **serveur EventSub factice** qui parle exactement le même protocole que Twitch — `session_welcome`, `session_keepalive`, `notification` — et ChronoCast n'a pas à savoir qu'il n'est pas en face du vrai.

Tout passe par un conteneur : la CLI n'est pas installée sur l'hôte.

---

## 1. Marche à suivre

**Terminal 1** — le serveur factice, au premier plan :

```bash
./scripts/twitch-mock.sh serve
```

Il écoute sur `ws://127.0.0.1:8080/ws` et journalise chaque connexion et chaque notification. C'est la moitié de l'intérêt de la manœuvre : on voit ce qui part.

**Pointez ChronoCast dessus.** Dans `%APPDATA%\ChronoCast\config.json` — ou dans le répertoire de données du point d'entrée headless —, remplacez :

```json
"eventsubUrl": "wss://eventsub.wss.twitch.tv/ws"
```

par :

```json
"eventsubUrl": "ws://127.0.0.1:8080/ws"
```

Puis redémarrez l'application. La vue *Twitch* du panneau doit passer à **connecté**.

**Terminal 2** — déclenchez des événements :

```bash
./scripts/twitch-mock.sh trigger subscribe
./scripts/twitch-mock.sh scenario     # les quatre événements du barème, à la file
```

Le compteur doit bouger, l'overlay jouer son animation, et l'événement apparaître dans l'historique.

**Pour finir :**

```bash
./scripts/twitch-mock.sh stop
```

Et remettez `eventsubUrl` à sa valeur d'origine — sans quoi ChronoCast tentera indéfiniment de joindre un serveur éteint.

## 2. Les événements qui comptent

| Commande | Ce qu'elle simule | Ce qu'on vérifie |
| --- | --- | --- |
| `trigger subscribe` | Un nouvel abonnement | Le palier crédite le bon nombre de secondes |
| `trigger subscription-message` | Un réabonnement | Barème `resub`, distinct de `sub` |
| `trigger subscription-gift` | Un don d'abonnements | Le plafond par événement s'applique |
| `trigger cheer` | Un don de bits | Le mode linéaire ou par paliers |

`--transport=websocket` est ajouté par le script, et il est **indispensable** : sans lui la CLI vise les webhooks, que ChronoCast n'implémente pas et n'implémentera pas.

Les options de la CLI se passent après la commande :

```bash
./scripts/twitch-mock.sh trigger cheer --bits 1000
./scripts/twitch-mock.sh trigger subscribe --tier 3000
```

Pour tout le reste de la CLI :

```bash
./scripts/dc.sh twitch event trigger --help
```

## 3. Ce que ce montage permet de vérifier, et rien d'autre

**Ce qu'il prouve :** le barème, les plafonds, la persistance, l'historique, la diffusion vers l'overlay, l'affichage, les animations. C'est-à-dire toute la chaîne à partir de la notification.

**Ce qu'il ne prouve pas :** OAuth, le rafraîchissement de jeton, la création de souscriptions par Helix, la reconnexion sur `session_reconnect`. Le serveur factice ne fait pas d'authentification, et ChronoCast le rejoint sans jeton valide.

**La déduplication non plus n'est pas éprouvée ici** — chaque tir de la CLI porte un `message_id` neuf. Pour la vérifier, il faut rejouer deux fois la **même** notification, ce que font les tests d'intégration en injectant deux fois le même identifiant.

## 4. Le cas particulier des subs Prime

Un sub Prime n'est distinguable d'un Tier 1 que par `channel.chat.notification` : `channel.subscribe` ne porte pas l'information. C'est pourquoi ce flux est déclaré **en premier** dans le catalogue de souscriptions — en cas de doublon sémantique, c'est lui qui aura fixé le palier.

La CLI sait le simuler :

```bash
./scripts/dc.sh twitch event trigger channel.chat.notification --transport=websocket
```

Vérifiez alors que le barème appliqué est bien `rewards.sub.prime` et non `tier1`, **et que le compteur n'a été crédité qu'une fois** si les deux flux ont porté le même abonnement.

## 5. Version figée, et pourquoi

L'image du conteneur épingle une version précise de la CLI, dont la somme de contrôle publiée est vérifiée à la construction. Une mise à jour de la CLI ne doit jamais changer le comportement des tests sans décision explicite : le jour où elle modifie une charge utile, on veut le savoir en changeant le numéro, pas en constatant un échec inexpliqué.

## 6. Quand ça ne marche pas

**La vue *Twitch* reste sur « déconnecté ».** L'URL doit être `ws://` et non `wss://` — le serveur factice ne fait pas de TLS. Vérifiez aussi que le conteneur tourne : le terminal 1 doit afficher son journal.

**Le serveur voit la connexion mais le compteur ne bouge pas.** L'événement est parti mais n'a pas été retenu : regardez les journaux de l'application. Une charge utile refusée par la validation Zod y est tracée, avec la raison.

**Le port 8080 est déjà pris.** Changez la correspondance de ports dans `docker/compose.yml`, et l'URL en conséquence.

**Rien ne se passe et aucun journal n'apparaît.** L'application a peut-être gardé l'ancienne URL : le changement de `eventsubUrl` exige un redémarrage, il n'est pas rechargé à chaud.
