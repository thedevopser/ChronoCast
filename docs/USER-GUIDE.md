# Guide utilisateur

ChronoCast affiche sur votre stream un compte à rebours qui s'allonge à chaque sub, resub, sub offert, sub Prime ou don de bits. Tout tourne sur votre machine : aucun compte à créer chez nous, aucun abonnement, aucune donnée qui sort ailleurs que vers Twitch.

Ce guide couvre l'installation, la connexion à Twitch, l'ajout dans OBS et l'usage au quotidien. Comptez un quart d'heure la première fois, dont l'essentiel passe chez Twitch à créer une application.

---

## 1. Installer

ChronoCast s'installe depuis le **Microsoft Store** : [Installer ChronoCast](https://apps.microsoft.com/detail/9MT0NZV7KXGV). Cherchez « ChronoCast » dans l'application Store si vous préférez.

L'installation se fait **pour votre compte utilisateur uniquement** : elle ne demande pas les droits administrateur.

## 2. Créer une application Twitch

ChronoCast a besoin d'une application Twitch **qui vous appartient**. C'est ce qui lui permet de lire les événements de votre chaîne sans qu'aucun serveur tiers ne soit impliqué.

1. Ouvrez la [console développeur Twitch](https://dev.twitch.tv/console/apps) et connectez-vous.
2. **Enregistrer votre application.**
3. Donnez-lui le nom que vous voulez — « ChronoCast » fait l'affaire.
4. **URL de redirection OAuth :** `http://localhost:37771/callback`
5. **Catégorie :** Application Chat Bot.
6. Créez, puis relevez l'**ID client** et générez un **secret client**.

> **Le port 37771 n'est pas modifiable.** Twitch exige que l'URL de redirection corresponde *exactement* à celle déclarée, et il n'accepte le HTTP simple que pour le nom `localhost` — pas pour `127.0.0.1`. Ces deux contraintes viennent de Twitch, pas de ChronoCast.

Le secret client s'affiche **une seule fois**. Copiez-le tout de suite ; en cas d'oubli, il suffit d'en générer un nouveau.

## 3. Suivre l'assistant

Au premier lancement, ChronoCast ouvre son assistant de configuration. Il vous demande dans l'ordre :

1. **L'ID client et le secret** de l'application créée à l'étape précédente.
2. **L'autorisation Twitch.** Un clic ouvre votre navigateur sur la page d'autorisation Twitch. Vous acceptez, et **la fenêtre de ChronoCast revient d'elle-même au premier plan** — l'onglet du navigateur peut être fermé.
3. **La durée de départ** du compteur, douze heures par défaut.
4. **Le barème** : combien de temps ajoute chaque type d'événement.

Le secret est chiffré sur votre machine par Windows, lié à votre compte, et n'est jamais réaffiché.

**Les autorisations demandées** dépendent de ce que vous activez :

| Autorisation | Sert à |
| --- | --- |
| `channel:read:subscriptions` | Les subs, resubs et sub offerts |
| `bits:read` | Les dons de bits |
| `user:read:chat`, `user:bot` | Distinguer un sub Prime d'un Tier 1, et lire la commande `!addtime` |

## 4. Ajouter l'overlay dans OBS

Dans OBS, sur la scène de votre choix : **+** → **Source navigateur** → nommez-la « ChronoCast ».

| Champ | Valeur |
| --- | --- |
| URL | `http://127.0.0.1:3777/overlay` |
| Largeur | 800 |
| Hauteur | 200 |
| Actualiser le navigateur lorsque la scène devient active | à cocher |

Le fond est transparent : le compteur se pose sur votre scène sans rectangle noir. Redimensionnez et déplacez la source comme n'importe quelle autre.

Si vous avez changé le port dans les paramètres, remplacez `3777` par le vôtre. L'adresse exacte est affichée dans le panneau et copiable d'un clic depuis l'icône près de l'horloge.

> **Une source navigateur ne se recharge jamais toute seule.** Après un changement d'apparence, faites un clic droit sur la source → **Propriétés** → bouton **Actualiser le cache de la page actuelle**. Il n'y a pas de raccourci clavier pour ça. La case « Actualiser le navigateur lorsque la scène devient active » évite d'y penser : changez de scène et revenez.

## 5. Le panneau d'administration

Il s'ouvre depuis la fenêtre de ChronoCast, ou dans un navigateur à l'adresse `http://127.0.0.1:3777/admin`.

| Vue | Contenu |
| --- | --- |
| **Tableau de bord** | Le compteur, l'état de la connexion Twitch, les derniers événements, et les commandes : pause, reprise, ajout ou retrait de temps |
| **Barème** | Combien de secondes ajoute chaque événement |
| **Apparence** | Police, taille, couleurs, ombre, contour, halo, cadre, dégradé, bulles d'annonce — avec un aperçu qui est l'overlay réel |
| **Twitch** | État de la connexion, souscriptions actives, reconnexion, révocation |
| **Historique** | Tous les événements reçus, avec leur montant — **y compris ceux qui n'ont rien crédité**, et la raison |
| **Journaux** | Ce que fait l'application, utile en cas de problème |
| **Paramètres** | Port, journalisation, rétention, et un bouton vers les réglages de démarrage de Windows |
| **Import / export** | Sauvegarder votre configuration dans un fichier, ou en recharger une |
| **À propos** | Version, licence, lien vers le code source |

Le panneau n'écoute que sur votre machine. Il n'est accessible ni depuis votre réseau local, ni depuis Internet.

## 6. Les dons hors Twitch

ChronoCast crédite ce que **Twitch** lui rapporte : subs, resubs, sub offerts, sub Prime, bits. C'est tout.

Rien n'est plafonné. Mille abonnements offerts d'un coup valent mille fois le tarif du palier, et le compteur peut monter aussi haut que votre communauté le décide.

**Aucune plateforme de dons tierce n'est prise en charge** — ni Streamlabs, ni StreamElements, ni Ko-fi, ni Tipeee, ni PayPal. Ce n'est pas un oubli. Recevoir un don depuis une de ces plateformes suppose soit un port ouvert sur Internet pour accueillir leurs notifications, soit une connexion sortante permanente vers leurs serveurs. ChronoCast s'interdit les deux : c'est ce qui lui permet de ne parler qu'à Twitch et de ne rien exposer de votre machine.

### La voie prévue : `!addtime`

Pour créditer du temps depuis le direct, une commande de chat existe.

1. Vue **Twitch** du panneau : cochez **Lire le chat pour les commandes**.
2. **Redémarrez ChronoCast.** Cocher la case ne suffit pas : la souscription au chat se crée au démarrage.
3. Dans votre chat, tapez `!addtime 300` pour ajouter cinq minutes.

Trois règles :

- **Seuls le diffuseur et les modérateurs** sont obéis. Un viewer ordinaire est ignoré en silence.
- La valeur est un **nombre entier de secondes**, strictement positif.
- Au-delà d'**une heure en une seule commande**, elle est refusée plutôt qu'écrêtée : à cette échelle, c'est une faute de frappe bien plus souvent qu'une intention. Les réglages de la commande apparaissent dans la vue *Barème*, en lecture seule.

Rien n'empêche votre bot d'alerte, s'il est modérateur de votre chaîne, d'envoyer lui-même `!addtime` quand un don arrive sur votre plateforme habituelle. **Sachez alors ce que vous faites** : c'est votre plateforme qui décide combien de secondes valent combien d'euros, pas ChronoCast. Si les deux barèmes divergent, rien ne le détectera — ni vous, ni l'application, ni vos viewers.

Et si vous préférez ne rien automatiser, la vue *Tableau de bord* a toujours ses champs **Ajouter** et **Retirer**, avec un motif libre qui se retrouve dans l'historique.

## 7. Au quotidien

**Fermer la fenêtre n'arrête pas le compteur.** L'application se replie près de l'horloge et continue de tourner — c'est délibéré : un compteur de subathon ne doit pas pouvoir être tué par réflexe en plein direct. Un clic droit sur l'icône donne l'état du compteur, l'ouverture du panneau, la copie de l'URL de l'overlay, et **Quitter ChronoCast**, seul chemin qui arrête vraiment.

**Le compteur survit à tout** : fermeture, coupure de courant, redémarrage. Il repart exactement là où il s'était arrêté, à cinq secondes près et toujours en votre faveur. Voir [CRASH-RECOVERY.md](CRASH-RECOVERY.md).

**Vos données** vivent dans `%USERPROFILE%\ChronoCast` — collez ce chemin dans l'explorateur pour y accéder :

| Fichier | Contenu |
| --- | --- |
| `config.json` | Tous vos réglages |
| `counter.json` | L'état du compteur |
| `secrets.json` | Jetons Twitch, chiffrés |
| `logs/` | Journaux |
| `history/` | Historique des événements |
| `custom.css` | Votre feuille de style, si vous en avez une |

Désinstaller ChronoCast **ne supprime pas ce répertoire** : réinstaller vous rend votre configuration et votre compteur. C'est précisément la raison pour laquelle ces fichiers ne sont pas rangés là où Windows range habituellement les données d'une application du Store — cet emplacement-là part à la désinstallation.

**Les mises à jour** sont gérées par le Microsoft Store et s'appliquent toutes seules. Le Store attend que ChronoCast ne soit pas en cours d'exécution : **aucune fermeture surprise en plein direct**. Si vous voulez forcer une vérification, ouvrez le Store → **Bibliothèque** → *Obtenir les mises à jour*.

**Lancer ChronoCast à l'ouverture de la session** se règle dans Windows, et non dans ChronoCast : *Paramètres* → *Applications* → *Démarrage*. Le bouton de la vue *Paramètres* vous y emmène directement. ChronoCast y figure sous son propre nom, désactivé par défaut.

## 8. Quand quelque chose ne va pas

**Le compteur ne bouge pas alors qu'un sub vient de tomber.** Regardez la vue *Twitch* : si une souscription manque, c'est presque toujours une autorisation oubliée. Reconnectez-vous depuis cette vue, ce qui redemande les portées manquantes.

**L'overlay reste vide ou affiche `--:--:--`.** La source navigateur ne joint pas le serveur. Vérifiez que ChronoCast tourne (icône près de l'horloge) et que le port de l'URL correspond à celui des paramètres.

**Le navigateur affiche « Ce site est inaccessible ».** L'application est arrêtée, ou un autre logiciel occupe le port. Changez-le dans *Paramètres*, puis corrigez l'URL dans OBS.

**Twitch refuse l'autorisation.** L'URL de redirection déclarée dans la console développeur doit être `http://localhost:37771/callback`, au caractère près — pas de barre oblique finale, pas de `127.0.0.1`.

**Après avoir changé de PC ou de compte Windows**, les jetons deviennent illisibles : Windows les a chiffrés pour l'ancien compte. ChronoCast rouvre alors son assistant. Vos réglages et votre compteur, eux, sont intacts.

Pour tout le reste, la vue *Journaux* dit ce qui s'est passé. Les secrets y sont masqués : vous pouvez la copier telle quelle dans un rapport de bug.
