# Modèle de menace et contrôles

ChronoCast écoute sur la boucle locale, manipule des jetons OAuth, et **affiche du contenu choisi par des tiers non fiables** dans une page. Ces trois faits définissent tout ce qui suit.

Chaque contrôle décrit ici est tenu par un test de `tests/security/`. Ce document dit ce qu'on défend et pourquoi ; le code dit comment.

---

## 1. Les quatre surfaces

| Surface | Ce qui entre | Ce qu'on redoute |
| --- | --- | --- |
| **Contenu Twitch** | Pseudonymes, messages, montants | Du HTML exécuté dans l'overlay, en direct |
| **Secrets** | ID client, secret, jetons | Une fuite par le disque, l'API, le WebSocket ou les journaux |
| **Serveur local** | Requêtes HTTP et WebSocket | Une page web quelconque qui pilote l'application |
| **Dépendances** | npm | Du code tiers exécuté à l'installation ou à l'exécution |

## 2. Le contenu venu de Twitch

**N'importe quel spectateur choisit son pseudonyme.** Il peut y mettre `<img src=x onerror=…>`, et ce pseudonyme s'affiche dans une Browser Source OBS — c'est-à-dire dans un Chromium, en direct, devant l'audience.

Quatre contrôles, appliqués sans exception :

**`textContent` exclusivement.** `innerHTML` est banni par ESLint. Tout ce qui entre dans le DOM passe par `src/web/shared/safe-dom.ts`, seul module autorisé à écrire dans le document.

**CSP stricte, sans `unsafe-inline`.** Ni balise `<style>`, ni attribut `style=`, ni script en ligne. Conséquence directe : la personnalisation de l'overlay **ne peut pas** être une feuille de style composée à partir de la configuration — elle passe par des variables CSS posées via le CSSOM, seule voie que la directive laisse ouverte.

```
default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self';
img-src 'self' data:; connect-src 'self' ws://127.0.0.1:* ws://localhost:*;
object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'
```

`base-uri 'none'` mérite un mot : sans lui, une balise `<base>` injectée détournerait vers un serveur distant chaque chemin relatif de la page.

**Longueurs tronquées.** Un pseudonyme est coupé à soixante-quatre graphèmes, et la mise en page se protège en plus d'une chaîne démesurée — soixante-quatre idéogrammes pleine chasse débordent d'un écran.

**Tout JSON externe passe par Zod**, avec les clés `__proto__` retirées avant validation. Les tailles de message sont plafonnées.

Dans les journaux, les retours à la ligne et les séquences ANSI sont échappés : une console n'est pas un terrain de jeu pour du texte choisi par un tiers.

## 3. Les secrets

**Chiffrés au repos.** Sous Electron, par `safeStorage`, donc DPAPI, qui lie le chiffrement au compte Windows. Deux règles absolues :

- **jamais de repli en clair.** Si le chiffrement est indisponible, l'écriture échoue franchement. Un repli silencieux serait pire que l'échec : il donnerait l'illusion d'être protégé ;
- **un blob indéchiffrable rend `null`, jamais une exception.** Le cas est réel — un répertoire de données recopié depuis un autre compte est illisible — et l'utilisateur doit retomber sur l'assistant, pas sur un écran de crash.

**Jamais renvoyés par l'API.** Les champs de secret sont en écriture seule : l'API répond `hasClientSecret: true`, jamais la valeur. Une configuration exportée depuis le panneau ne les contient pas.

**Jamais diffusés sur le WebSocket.** Le canal est en lecture seule et ne transporte que l'état du compteur, les événements et la configuration d'apparence.

**Systématiquement rédigés dans les journaux.** Les secrets sont déclarés à un rédacteur au moment où ils sont chargés ; ils sont masqués partout ensuite, **y compris s'ils se retrouvent au milieu d'un message d'erreur**.

## 4. Le serveur local

Un serveur qui écoute sur une machine de bureau est à portée de n'importe quelle page ouverte dans le navigateur de l'utilisateur. D'où :

**Bind `127.0.0.1` strict.** Le schéma n'accepte que la boucle locale : `0.0.0.0` est refusé par validation, pas par convention. Écouter sur toutes les interfaces exposerait le panneau au réseau local.

**Garde anti-DNS-rebinding sur `Host`.** Un nom de domaine contrôlé par un attaquant peut être résolu vers `127.0.0.1`, ce qui contourne l'origine. L'en-tête `Host` est donc comparé à une liste close, exactement, sans tolérance de suffixe.

**Jeton CSRF sur toute mutation.** Injecté dans la page au moment de la servir, il n'est exposé par aucune route : une page tierce ne peut ni le lire ni le deviner. Les comparaisons sont à temps constant.

**Aucun en-tête CORS permissif, et il ne faut jamais en ajouter un.** Un seul suffirait à annuler la garde d'`Host`, en autorisant une page tierce à lire les réponses qu'elle provoque.

**Protection contre la traversée de chemin.** On résout, puis on vérifie que le chemin résolu reste sous la racine — filtrer la chaîne d'entrée ne fonctionne jamais, il y a toujours un encodage de plus. Le contrôle est **refait après canonisation**, parce que la résolution ne voit pas les liens symboliques. Les deux côtés de la comparaison sont canoniques : comparer une forme canonique à une forme qui ne l'est pas refuse tout, ce qui est arrivé sous Windows avec les noms courts 8.3.

**Toute erreur produit la même `404`**, quelle qu'en soit la cause. Un `403` distinct confirmerait à l'attaquant que le fichier visé existe.

## 5. Le flux OAuth

**Le `state` est la seule défense** contre l'attaque classique : un tiers déclenche son propre flux, glisse **son** code dans la session du streamer, et ChronoCast se retrouve connecté au compte de l'attaquant. Trente-deux octets aléatoires, comparés à temps constant.

**Le gestionnaire de rappel ne voit jamais le `state` attendu.** Il ne reçoit qu'un `verifyState()` qui répond oui ou non : il ne peut donc ni le journaliser, ni le renvoyer dans une page.

**Un `state` qui ne correspond pas ne consomme rien.** N'importe quelle page distante peut provoquer une navigation vers la boucle locale ; si un `state` erroné suffisait à clore le flux, le premier venu ferait échouer la connexion du streamer, à distance et en boucle.

**La page de rappel ne montre qu'un code d'issue clos** — `ok`, `denied` ou `failed`. Ni le code d'autorisation, ni le message d'erreur de Twitch, qui est du texte contrôlé par un tiers.

**Le serveur de rappel est éphémère.** Il est armé le temps d'une autorisation et s'éteint dès le rappel reçu, y compris en cas d'échec : un code d'autorisation est à usage unique, et laisser le port armé n'offrirait qu'une surface de plus.

## 6. La fenêtre Electron

**Durcissement non négociable** : `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, **aucun preload**. Les pages sont servies par le serveur HTTP local, elles n'ont besoin d'aucun pont vers Node.

**Politique de navigation en liste blanche.** L'origine locale est la seule autorisée *dans* la fenêtre. Les pages Twitch sont renvoyées au **navigateur système** — le flux OAuth y passe, la fenêtre n'a aucune raison d'afficher une page Twitch. Tout le reste est bloqué. La comparaison d'hôte est exacte : `id.twitch.tv.evil.com` se termine par `twitch.tv` sans rien avoir de commun avec Twitch, et `https://id.twitch.tv@evil.com` pointe vers `evil.example`.

**Les outils de développement sont fermés dans une application packagée.** Ils donneraient accès au panneau et à tout ce qu'il peut faire.

## 7. La chaîne d'approvisionnement

**Trois dépendances de production** : `electron`, `ws`, `zod`. C'est peu, et c'est délibéré.

**`npm ci --ignore-scripts`.** Aucun script post-install de dépendance tierce ne s'exécute, ce qui ferme une voie d'attaque classique. Aucune dépendance de production n'en a besoin.

**`npm audit --audit-level=high` est bloquant en CI**, avec droit de veto sur chaque PR.

**Les scripts d'outillage sont sans dépendance.** La préparation des icônes décode et réencode le PNG en une centaine de lignes de bibliothèque standard plutôt que de tirer une bibliothèque d'images, son arbre transitif et ses binaires natifs — pour un travail qu'on fait trois fois dans la vie du projet.

## 8. La mise à jour automatique

Depuis la `0.5.0`, ChronoCast interroge GitHub pour savoir s'il existe une version plus récente, télécharge l'installeur en tâche de fond et **propose** son installation. Il ne l'installe jamais de lui-même.

### Ce que cela change dans le trafic sortant

Deux hôtes s'ajoutent à ceux de Twitch : **`api.github.com`** et **`objects.githubusercontent.com`**, en HTTPS. Les requêtes ne portent **ni jeton ni identifiant** — l'API publique des releases n'en demande pas — et il en part quatre par jour. Ce que GitHub peut en déduire se limite à une adresse IP et à la version installée, que le `User-Agent` annonce.

Le réglage **« Vérifier les mises à jour »**, dans *Paramètres*, coupe entièrement ce trafic. Il est activé par défaut : un correctif qui ne parvient à personne ne corrige rien.

### SmartScreen ne protège pas ce chemin, et c'est le point important

Le binaire n'est pas signé — un certificat coûte plusieurs centaines d'euros par an. Mais surtout : **le fichier téléchargé par ChronoCast ne porte aucune *Mark of the Web***. Windows n'écrit ce flux alternatif `Zone.Identifier` que lorsqu'un navigateur ou un client de messagerie dépose le fichier ; un téléchargement fait par l'application ne le reçoit pas. **SmartScreen ne se déclenchera donc jamais sur cet installeur, altéré ou non.**

Deux contrôles compensent, et ils sont indépendants.

**Le condensat SHA-256.** Le workflow `Release` publie un `.sha256` à côté de chaque installeur. ChronoCast le télécharge **avant** l'installeur, vérifie qu'il désigne bien le fichier attendu — un condensat valide portant sur un autre artefact validerait n'importe quoi — puis compare l'empreinte des octets reçus. **Rien n'est écrit sur le disque avant cette vérification** : les octets restent en mémoire, et un installeur non vérifié n'existe jamais sous forme de fichier. Discordance : tout est jeté, l'incident est journalisé, rien n'est lancé.

**Le contrôle d'URL.** Les adresses de téléchargement sont **analysées**, jamais comparées par préfixe, et doivent mener exactement à l'artefact attendu du dépôt `thedevopser/ChronoCast`. C'est ce qui empêche une réponse d'API contrefaite d'envoyer le téléchargement ailleurs. `https://github.com@evil.test/…` commence par la bonne chaîne et ne va pas du tout au bon endroit : `hostname` ignore l'identifiant qui précède l'arobase.

Le dépôt source est une **constante du code, jamais un réglage**. Le rendre configurable donnerait à qui saurait écrire dans le fichier de configuration la capacité de faire télécharger et lancer un exécutable arbitraire — c'est-à-dire transformerait un réglage en exécution de code.

**L'asset est cherché par son nom exact**, déduit de la version, et non pris parmi les `.exe` de la release : un artefact étranger déposé sur une release ne peut pas se substituer à l'installeur.

### Ce qui protège le direct

**Rien ne s'installe sans un clic.** Installer ferme l'application ; le faire d'autorité pendant un subathon coûterait le stream. Quand le compteur tourne, le panneau demande en plus une confirmation qui dit ce qui va se passer. L'arrêt passe par le chemin propre, celui qui écrit le dernier état du compteur avant de sortir.

## 9. Ce que ChronoCast ne fait pas

- **Aucune télémétrie**, aucune statistique d'usage, aucun rapport de crash envoyé.
- **Aucune connexion sortante** en dehors de Twitch — `id.twitch.tv`, `api.twitch.tv`, `eventsub.wss.twitch.tv` — et de GitHub pour les mises à jour, désactivable.
- **Aucun webhook**, donc aucun nom de domaine ni port ouvert sur Internet.
- **Aucune installation automatique** : une mise à jour est proposée, jamais appliquée sans votre accord.

## 10. La suite de tests de sécurité

| Fichier | Ce qu'il défend |
| --- | --- |
| `xss-overlay.test.ts`, `xss-admin.test.ts`, `xss-admin-lists.test.ts`, `xss-setup.test.ts` | Un pseudonyme hostile n'est jamais interprété |
| `host-guard.test.ts` | Un `Host` non-loopback est rejeté |
| `csrf.test.ts` | Une mutation sans jeton est refusée |
| `static-handler.test.ts` | La traversée de chemin et les liens sortants sont bloqués |
| `headers.test.ts` | La CSP et les en-têtes sont ceux attendus |
| `api-hardening.test.ts` | Un import de configuration malveillant est refusé, les secrets n'apparaissent nulle part |
| `navigation-policy.test.ts` | Seules l'origine locale et Twitch sont admises, et Twitch au navigateur |
| `browser-opener.test.ts` | Seul `https:` est ouvert à l'extérieur |

Ces tests emploient de vraies charges hostiles, et ils tournent dans un vrai parseur HTML : un faux `document` prouverait qu'on a appelé `textContent`, pas qu'aucun script n'a été exécuté.

## 11. Signaler une faille

Ouvrez une issue sur [le dépôt](https://github.com/TheDevOpser/ChronoCast/issues). ChronoCast est une application locale sans service en ligne : il n'y a pas d'infrastructure à compromettre, et donc pas de divulgation coordonnée à organiser. Décrivez ce que vous avez trouvé, c'est le plus utile.
