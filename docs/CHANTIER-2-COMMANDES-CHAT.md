# Chantier 2 — Commandes de chat Twitch

> **Ce chantier n'est pas commencé.** Ce document est sa conception, arrêtée avec l'utilisateur, consignée pour être reprise plus tard sans avoir à refaire l'analyse. Aucune ligne de code de production n'a été écrite. Les décisions du tableau ci-dessous sont **actées** et rejoindront la section 4 de [REPRISE-V2.md](REPRISE-V2.md) le jour où le chantier démarrera.

---

## 1. Objectif

La V1 crédite du temps sur ce que Twitch monétise : abonnements, bits, raids, follows. Rien ne permet au streamer ni à ses modérateurs de créditer du temps sur un fait de jeu — une mort, un pari perdu, un défi relevé. Il faut aujourd'hui ouvrir le panneau d'administration et saisir une durée à la main, c'est-à-dire faire précisément ce qu'on ne peut pas faire en plein direct.

Ce chantier ouvre une seconde source d'événements : **un modérateur tape `!addmort` dans le chat, ChronoCast ajoute les secondes définies dans son barème.** C'est le premier événement de ChronoCast qui ne vient pas d'un soutien financier, et le premier dont le déclencheur est une intention humaine plutôt qu'une action de plateforme.

---

## 2. Décisions actées

| Sujet | Décision | Justification |
| --- | --- | --- |
| Qui déclenche | **Modérateurs et diffuseur seuls**, sur le badge porté par la charge utile. Jamais sur le pseudo | Le badge est une donnée de plateforme, le pseudo est une chaîne qu'on peut imiter |
| Ce qu'une commande fait | **Créditer ou retirer du temps**, et **afficher un effet sur l'overlay** — texte d'abord, image ensuite | C'est le besoin exprimé : « +1 mort » doit se voir à l'écran, pas seulement dans le compteur |
| Répondre dans le chat | **Hors périmètre** | Un bot tiers — StreamElements — répond déjà. ChronoCast se contente d'écouter |
| Écriture sur Twitch | **Aucune** | Pas de portée `user:write:chat`, donc pas de réauthentification, et l'application reste en lecture seule sur Twitch |
| Panneau de boutons type « streamdeck » | **Écarté pour l'instant** | Voir la section 8 : ce n'est qu'un second déclencheur sur le même catalogue, et il ne coûterait que son interface |
| Portées OAuth | **Aucune nouvelle** dans la configuration par défaut | `channel.chat.message` réclame `user:read:chat` et `user:bot`, déjà demandées par `channel.chat.notification`, active par défaut |

### Conséquence opérationnelle qu'aucun code ne peut rattraper

StreamElements et ChronoCast voient le même message chacun de leur côté, et ne se parlent jamais. Si le bot annonce « +60 s » alors que le barème de ChronoCast dit 30, **le chat ment aux spectateurs**, et rien dans l'application ne peut le détecter ni le corriger. Les deux réglages se tiennent accordés à la main. Le champ de saisie du panneau doit le dire, et le guide de l'utilisateur aussi.

---

## 3. Ce qui existe déjà et qu'on ne réécrit pas

- **`SUBSCRIPTION_PLAN`** ([subscription-plan.ts](../src/core/twitch/subscription-plan.ts)) se présente lui-même comme « point d'extension unique de l'application » : une entrée dans le tableau suffit à souscrire `channel.chat.message`.
- **Les portées sont déjà demandées.** Elles sont calculées et non figées, par `requiredScopes`. Seul quelqu'un ayant désactivé `enableChatNotifications` devra se réauthentifier, et `describe()` expose déjà `missingScopes` pour le lui annoncer plutôt que de le laisser face à un compteur immobile. *(Le détail des portées de `channel.chat.message` est à reconfirmer sur la documentation Twitch courante au premier commit.)*
- **Le statut de modérateur est dans la charge utile** : le tableau `badges` porte `set_id: "moderator"` ou `"broadcaster"`. Aucun appel Helix, aucune portée de modération.
- **La bulle de l'overlay sort gratuitement du pipeline.** `EventMessage` porte déjà `event`, `rewardSeconds` et `applied`, et [overlay/main.ts](../src/web/overlay/main.ts) en fait un toast. Dès le lot 1, `!addmort` affichera « Pseudo +30 s » sans une seule ligne de code d'overlay.
- **L'éditeur de liste à cardinalité variable a son précédent** : [bits-tiers.ts](../src/web/admin/bits-tiers.ts), seul réglage que `form-binding.ts` ne prend pas en charge. On le suit, on ne l'invente pas.
- **La déduplication par `message_id`** est déjà appliquée en amont, dans `ingestNotification`.

---

## 4. Architecture

Le pipeline de [application.ts](../src/core/app/application.ts) reste tel quel. Une seule branche s'y ajoute, et elle se place **avant** le convertisseur :

```
EventSubClient.onNotification
  → déduplication sur message_id                    (inchangé)
  → si channel.chat.message → CommandService        ← nouveau
      → analyse, autorisation, temps de recharge
      → CommandEvent, ou rien du tout
  → sinon → mapNotification                          (inchangé)
  → CounterService.applyEvent → historique → WsHub   (inchangé)
```

**Pourquoi la branche est avant le convertisseur, et non un cas de plus dedans.** `channel.chat.message` livre **chaque message du chat**, un volume sans commune mesure avec ce que l'application traite aujourd'hui. Faire traverser tout le chat au convertisseur puis à la déduplication sémantique serait du gaspillage à chaque message et remplirait les journaux. [event-mapper.ts](../src/core/twitch/event-mapper.ts) reste le convertisseur des événements *comptables* ; il est pur et ne connaît pas la configuration des commandes, ce qui l'empêche de toute façon de trancher.

**La déduplication sémantique est délibérément sautée pour les commandes.** Deux `!addmort` à quelques secondes d'écart sont deux morts, pas un doublon — c'est le temps de recharge qui les arbitre, pas la déduplication. `semanticKey` étant un `switch` exhaustif, il faudra néanmoins un cas `command` : il rendra une clé incluant le `messageId`, donc jamais collidante, avec le commentaire qui explique pourquoi.

**Le filtrage est précoce, et c'est une décision anti-abus.** Message sans préfixe, commande inconnue, auteur non habilité, commande en recharge : tout est écarté par le `CommandService` avant de produire quoi que ce soit. Rien n'entre dans l'historique, rien ne part sur le WebSocket. Sans cela, un spectateur martelant `!addmort` remplirait l'historique du streamer une ligne à la fois.

**Le barème reste le seul juge des secondes.** Le `CommandEvent` porte le *nom* de la commande, jamais sa durée ; `computeReward` va la chercher dans `rewards.commands`. C'est ce qui maintient l'invariant central du projet — aucune valeur métier hors du schéma — et ce qui garde le module de chat exempt de toute décision de barème.

---

## 5. Lot 1 — Recevoir et exécuter

Dans l'ordre TDD, chaque module rouge avant d'être écrit.

### Nouveaux modules purs, `src/core/chat/`

- **`command-parser.ts`** — `parseCommand(text)` rend `{ name, args }` ou `null`. Préfixe `!` fixe : un réglage de plus est une question de support de plus, c'est l'argument qui a fait retirer le mode `separate` en V1. Insensible à la casse, tolérant aux espaces multiples. **Piège à couvrir : Twitch ajoute le caractère invisible `U+E0000` en fin de message pour contourner sa propre détection de doublon.** Sans normalisation, la seconde occurrence d'une commande ne serait jamais reconnue, et personne ne comprendrait pourquoi.
- **`chatter-badges.ts`** — `isPrivileged(badges)` rend vrai sur `broadcaster` ou `moderator`. Une douzaine de lignes, testée pour elle-même parce que c'est la porte d'autorisation, et qu'une porte se vérifie séparément de ce qu'elle garde.
- **`command-service.ts`** — résout la commande dans la configuration, vérifie l'habilitation, applique le temps de recharge (`Clock` injectée, aucun minuteur), rend un `CommandEvent` ou une raison de refus. Ignore explicitement les messages venant de son propre compte et d'une liste de bots : sinon une réponse mal choisie de StreamElements pourrait un jour redéclencher une commande.

### Modifications

| Fichier | Changement |
| --- | --- |
| [subscription-plan.ts](../src/core/twitch/subscription-plan.ts) | Entrée `channel.chat.message` v1, portées `user:read:chat` + `user:bot`, `required: false`, activée par `enableChatCommands` |
| [schema.ts](../src/core/config/schema.ts) | `twitch.enableChatCommands` (défaut `false`) et `rewards.commands` : liste de `{ name, seconds (signé), cooldownSeconds, enabled }` |
| [domain-event.ts](../src/core/events/domain-event.ts) | `CommandEvent`, `DomainEventType` gagne `'command'`, `DomainEventSource` gagne `'chat-command'` |
| [reward-engine.ts](../src/core/counter/reward-engine.ts) | Cas `command` ; **`RewardComputation.seconds` devient signé**, et son commentaire avec |
| [counter-service.ts](../src/core/counter/counter-service.ts) | Dans `applyEvent` : branche sur le signe, `applyRemove` quand la récompense est négative |
| [event-mapper.ts](../src/core/twitch/event-mapper.ts) | Cas `command` dans `semanticKey`, avec une clé jamais collidante |
| [application.ts](../src/core/app/application.ts) | Branche `channel.chat.message` dans `ingestNotification`, câblage du `CommandService` |

### Le point à ne pas rater

`applyAdd` **refuse tout delta négatif ou nul** ([counter-state.ts](../src/core/counter/counter-state.ts)). Sans la branche de signe dans `applyEvent`, une commande de retrait ne ferait **rien du tout, sans la moindre erreur** : le compteur ne bougerait pas, l'historique dirait pourtant que l'événement a été appliqué, et le streamer chercherait la panne longtemps. Le test qui l'attrape s'écrit en premier.

### Interface

Un éditeur de liste dans la vue *Barème*, calqué sur `bits-tiers.ts` : nom, secondes signées, recharge, activation. Refuser un nom vide, un nom en double, un nom qui n'est pas alphanumérique — et le refuser là où on peut encore l'expliquer, comme le fait déjà `normalizeTiers` pour les seuils en double.

**Le garde-fou [fields.test.ts](../tests/unit/web/admin/fields.test.ts) rougira** dès que `rewards.commands` rejoindra le schéma, et ne redeviendra vert qu'une fois l'éditeur en place. C'est sa raison d'être, ce n'est pas un incident.

**Ce que TypeScript fera rougir tout seul**, et qu'il faut traiter plutôt que contourner : `dashboard-model.ts`, `history-view.ts`, `buildTestEvent` et `overlayTestSchema` dans [api.ts](../src/core/server/routes/api.ts), et `overlay/main.ts`. C'est exactement ce qui s'est produit au chantier 1 quand le message `update` a rejoint l'union.

---

## 6. Lot 2 — Le libellé sur l'overlay

Après le lot 1, `!addmort` affiche déjà « Pseudo +30 s ». Ce lot remplace ce libellé générique par celui de la commande — « +1 mort ».

- `rewards.commands[].overlayText` : chaîne bornée, venue de la configuration locale.
- `Toast` gagne un `label` facultatif, [toast-queue.ts](../src/web/overlay/toast-queue.ts) le transporte, l'overlay ajoute un `#toast-label` écrit par `setText`. **Aucun risque neuf** : ce texte ne vient pas du réseau, et `safe-dom` s'applique de toute façon.
- L'animation `overlay.animation.onAdd` se déclenche déjà sur tout ajout de temps : rien à faire de ce côté.

Lot volontairement petit, et livrable seul.

---

## 7. Lot 3 — L'image sur l'overlay

**Le lot cher, et le seul qui touche à la sécurité.** À décider séparément : les lots 1 et 2 sont pleinement utilisables sans lui.

C'est la première fois que ChronoCast servirait un fichier binaire déposé par l'utilisateur. Le patron existe — [custom-css.ts](../src/core/server/routes/custom-css.ts), avec sa canonisation par `realpath` et son contrôle de confinement — **mais avec une différence qui décide de tout** : là-bas aucun segment ne vient de l'URL, ici il en faut un.

- **Indexer par identifiant, jamais par nom.** La configuration déclare `{ id, file }` ; la route sert `/overlay-asset/<id>` et résout le nom en interne. Aucun octet venu de l'URL n'atteint le système de fichiers.
- **Sous-répertoire dédié** `%APPDATA%\ChronoCast\overlay-assets\`, jamais la racine des données : `tokens.json` en est le voisin immédiat.
- **Liste blanche d'extensions et de types MIME. Pas de SVG** — un SVG est un document, et un document peut porter du script.
- **Même `404` pour toute cause**, comme `custom-css.ts` : une réponse distincte dessinerait la carte du répertoire de données à qui la demande.
- **La CSP n'est pas touchée** : `img-src 'self' data:` couvre déjà le cas ([headers.ts](../src/core/server/security/headers.ts)).

---

## 8. Ce que ce chantier ne fait pas

- **Aucune écriture sur Twitch.** Pas de `user:write:chat`, pas de réauthentification. ChronoCast reste en lecture seule sur Twitch, et un défaut ne pourra jamais poster sous l'identité du streamer.
- **Aucun trafic sortant nouveau.** La promesse amendée en V2 — Twitch, plus GitHub pour les mises à jour — reste exacte.
- **Aucune surface entrante nouvelle** aux lots 1 et 2 : ni route, ni port, ni jeton. Le modèle de menace de [SECURITY.md](SECURITY.md) est inchangé jusqu'au lot 3, qui ajoute une seule route, en lecture.
- **Pas de panneau de boutons.** Écarté par l'utilisateur. À conserver néanmoins comme piste : **un bouton n'est qu'un second déclencheur sur le même catalogue d'actions**, et une fois ce catalogue écrit il ne coûterait plus que son interface. C'est d'ailleurs la raison pour laquelle les commandes de chat viennent en premier : elles obligent à concevoir le catalogue sous la contrainte la plus dure, celle où un tiers non fiable appuie sur la détente. Un catalogue conçu d'abord pour un clic de confiance devrait être durci ensuite ; l'inverse s'hérite gratuitement.

### La règle à tenir le jour où des boutons apparaîtront

La sécurité d'un tel panneau ne tient pas au fait que le bouton soit cliqué depuis une page de confiance. Elle tient à ce que **le catalogue d'actions soit fermé et typé**. La raison est concrète : `POST /api/config/import` existe, et un fichier de configuration se charge depuis le panneau — donc **tout ce qu'un bouton peut faire, un fichier de configuration reçu de quelqu'un d'autre peut le faire**. Un bouton qui stocke `{ action: 'add-time', seconds: 60 }` validé par Zod ne peut rien d'autre qu'ajouter du temps. Un bouton qui stockerait une URL, une ligne de commande ou un fragment de script transformerait le partage de configuration en exécution de code arbitraire.

---

## 9. Vérification

```bash
git branch --show-current          # jamais main
./scripts/dc.sh verify             # lint + les trois typechecks + tests + audit
```

Bout en bout, sans attendre un vrai modérateur, selon la méthode de [TESTING-TWITCH-CLI.md](TESTING-TWITCH-CLI.md) et son serveur EventSub factice :

```bash
./scripts/dc.sh twitch event trigger channel.chat.message
```

Les cas à éprouver, et pas seulement le nominal :

1. Un modérateur tape `!addmort` : le compteur monte du nombre configuré, la bulle s'affiche, l'historique porte une ligne.
2. **Un spectateur ordinaire tape `!addmort` : rien.** Ni compteur, ni bulle, ni ligne d'historique.
3. Deux `!addmort` en une seconde avec une recharge de dix : un seul crédit.
4. **Une commande à secondes négatives retire réellement du temps** — le cas qui échouerait silencieusement.
5. Le même message rejoué par Twitch : un seul crédit, par la déduplication sur `message_id`.
6. Une commande désactivée dans le panneau : rien. Et `enableChatCommands` à `false` : aucune souscription créée.

**Point notable pour ce chantier : il n'a aucune surface propre à Windows.** Ni processus lancé, ni écriture hors du répertoire de données, ni comportement d'installeur — contrairement au chantier 1. Un `verify` vert en conteneur dit ici presque tout, et la validation sur poste se réduit à confirmer qu'un vrai modérateur, sur une vraie chaîne, est bien reconnu comme tel.

---

## 10. Documents à mettre à jour le jour où le chantier sera livré

- [REPRISE-V2.md](REPRISE-V2.md) : section 4 (décisions actées), section 6 (chantier 2), section 9 (retirer la piste, devenue chantier).
- [USER-GUIDE.md](USER-GUIDE.md) : régler ses commandes, et **l'avertissement sur l'accord manuel avec le bot de chat**.
- [ARCHITECTURE.md](ARCHITECTURE.md) : la branche du pipeline.
- [SECURITY.md](SECURITY.md) : au lot 3 seulement, la route servant les images.

Le garde-fou [documentation.test.ts](../tests/unit/assets/documentation.test.ts) vérifie mécaniquement que tout lien relatif mène quelque part, et qu'aucun document ne cite une commande que `dc.sh` ne connaît plus.
