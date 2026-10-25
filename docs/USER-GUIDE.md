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
| `bits:read` | Les dons de bits, et les bits dépensés en Power-ups |
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

### La barre d'objectif, seconde source navigateur

Si vous avez défini des paliers — voir la section 5 —, ajoutez une **seconde** source navigateur, indépendante de la première :

| Champ | Valeur |
| --- | --- |
| URL | `http://127.0.0.1:3777/goal` |
| Largeur | 800 |
| Hauteur | 80 |

Elle affiche une barre unique portant le libellé de la promesse en cours et le compte, et rien d'autre. Placez-la où vous voulez : elle ne dépend pas de l'overlay du compteur, et l'une peut exister sans l'autre.

**Tant qu'aucun palier n'est défini, la page reste vide** — c'est l'état éteint des objectifs, et non une erreur.

## 5. Le panneau d'administration

Il s'ouvre depuis la fenêtre de ChronoCast, ou dans un navigateur à l'adresse `http://127.0.0.1:3777/admin`.

| Vue | Contenu |
| --- | --- |
| **Tableau de bord** | Le compteur, l'état de la connexion Twitch, les derniers événements, et les commandes : pause, reprise, ajout ou retrait de temps |
| **Barème** | Combien de secondes ajoute chaque événement |
| **Happy Hour** | Sa bascule, la programmation d'une plage, et le barème qui s'applique tant qu'il est actif |
| **Objectifs** | L'échelle de vos promesses, la progression en cours, et l'adresse de la barre à coller dans OBS |
| **Apparence** | Les deux pages que vous collez dans OBS, chacune sous son onglet — *Compteur* et *Barre d'objectif* — avec un aperçu qui est la page réelle et qui suit votre saisie sans enregistrement |
| **Twitch** | État de la connexion, souscriptions actives, reconnexion, révocation |
| **Historique** | Tous les événements reçus, avec leur montant — **y compris ceux qui n'ont rien crédité**, et la raison |
| **Journaux** | Ce que fait l'application, utile en cas de problème |
| **Paramètres** | Valeur de départ et plancher du compteur, reprise au démarrage, port, et un bouton vers les réglages de démarrage de Windows |
| **Import / export** | Sauvegarder votre configuration dans un fichier, ou en recharger une. L'import ne touche jamais au réglage Twitch : un fichier partagé par un autre streamer ne change ni votre application Twitch, ni votre compte, ni la lecture de votre chat |
| **À propos** | Version, licence, lien vers le code source |

Le panneau n'écoute que sur votre machine. Il n'est accessible ni depuis votre réseau local, ni depuis Internet.

### Les bits

Les bits se règlent par **un taux**, dans la vue *Barème* : *pour ce nombre de bits…* *…créditer ce nombre de secondes*. Par défaut, 100 bits pour 60 secondes.

**Chaque bit compte.** Le taux s'applique au bit près, et non par tranches entières : à 100 bits pour 60 secondes, un seul bit ajoute 0,6 seconde au compteur, 50 bits en ajoutent 30 et 150 bits en ajoutent 90. Il n'y a ni seuil minimum, ni palier : pour que les bits pèsent plus ou moins, changez le taux. Pour qu'ils ne créditent rien, mettez les secondes à 0.

Le décompte à l'écran avance en secondes entières : un don d'un seul bit ne fait pas toujours bouger le chiffre à l'instant où il arrive, mais son temps est bien acquis, et la bulle de l'overlay l'annonce (« +0,6 s »).

Les bits dépensés en Power-ups suivent le même taux — voir la section 6.

### Le Happy Hour

Une bascule qui **fait passer les crédits sur un barème à part**, le temps que vous décidez. **Tout se règle dans la vue *Happy Hour*** du menu : l'état et la bascule, la programmation d'une plage, le barème. Le **tableau de bord** garde une carte *Happy Hour* qui montre l'état et la plage programmée, avec le même bouton *Activer* / *Désactiver* pour basculer d'un clic en plein direct — les deux restent d'accord, même si vous gardez plusieurs onglets ouverts.

**Le Happy Hour a son propre barème**, que vous réglez dans la vue *Happy Hour* et enregistrez par son bouton *Enregistrer le barème Happy Hour* : les cartes *Happy Hour · Abonnements*, *Happy Hour · Réabonnements* et *Happy Hour · Sub offerts*, tier par tier et en secondes, puis *Happy Hour · Bits*, qui porte son propre taux. Tant que le Happy Hour est actif, c'est ce barème qui crédite, et lui seul ; un lot de sub offerts crédite toujours la valeur du tier multipliée par le nombre de sub.

Ce barème vaut au départ **le double de votre barème normal** : si vous aviez réglé un sub Tier 1 à cinq minutes, il en vaut dix en Happy Hour, comme avant. Il est ensuite indépendant — modifier le barème normal ne le change plus, et inversement. Le bouton *Copier vers…* au pied de chaque carte d'abonnement recopie ses valeurs dans les deux autres.

**Le taux des bits du Happy Hour se règle à part** : au départ il reprend le nombre de bits de votre taux normal, avec des secondes doublées — 100 bits pour 120 secondes si vous êtes à 100 bits pour 60. Libre à vous ensuite de le rendre plus ou moins généreux.

La commande `!addtime` n'est **jamais** concernée, parce qu'un modérateur qui tape 300 veut créditer 300.

**Sans plage programmée, le Happy Hour ne s'éteint pas tout seul** : il reste actif tant que vous ne le désactivez pas, et il survit à la fermeture de l'application. C'est pour cela que son état est affiché en permanence sur le tableau de bord — pensez à le couper quand la promesse est passée.

#### Programmer une plage

Pour ne pas avoir à y penser en plein direct, la carte *Programmer une plage* de la vue *Happy Hour* propose deux heures, *Début* et *Fin*, et un bouton *Programmer*. Le Happy Hour s'allume seul à l'heure de début, s'éteint seul à l'heure de fin, puis la plage s'efface.

- **Une heure désigne sa prochaine occurrence.** « 21:00 » saisi à 18 h vaut ce soir ; saisi à 22 h, il vaut demain.
- **Une fin antérieure ou égale au début tombe le lendemain du début** : de 23:00 à 01:00, la plage dure deux heures.
- **La vue et le tableau de bord affichent ce qui est programmé**, jour compris quand ce n'est pas aujourd'hui, et pendant la plage jusqu'à quelle heure le Happy Hour est actif. Le bouton *Annuler la plage* l'efface à tout moment, sans changer l'état courant du Happy Hour.
- **La plage ne se répète pas.** Elle joue une fois : pour le lendemain, programmez-en une nouvelle. Une seule plage existe à la fois.
- **Votre geste garde la main.** Le bouton *Activer* / *Désactiver* reste disponible à tout moment. Éteindre le Happy Hour à la main pendant la plage est respecté : il reste éteint, et la plage s'efface à son heure sans rien rallumer. L'allumer à la main avant le début ne décale rien : il sera éteint à la fin de la plage.
- **La plage survit à un redémarrage.** Relancée entre le début et la fin, l'application allume le Happy Hour ; relancée après la fin, elle efface la plage sans rien allumer.

Les nuits de changement d'heure, une heure qui n'existe pas — 02:30 au passage à l'heure d'été — est décalée d'une heure, et une heure qui existe deux fois — 02:30 au passage à l'heure d'hiver — désigne la première.

### Les objectifs

Un subathon tient rarement sur un chiffre qui grimpe : il tient sur des promesses. « À 50 subs je me rase la tête. » Les objectifs comptent ces promesses et les montrent à vos spectateurs, pour qu'ils voient ce que leur abonnement vient de faire avancer.

**Deux façons de compter**, à choisir dans la vue *Objectifs*, carte *Ce que compte la barre* :

| | Points | Abonnements seuls |
| --- | --- | --- |
| Bits et Power-ups | 1 bit = 1 point, sans réglage | ne comptent pas |
| Abonnements, réabonnements, sub offerts | les points de leur tier, réglables | 1 chacun, réglable par tier |
| Pour | un objectif où tout s'additionne, en subathon ou au mois | une promesse du type « à 50 subs je me rase la tête » |

Une installation neuve compte en points. **Changer de façon de compter remet le compte à zéro**, après un second clic de confirmation : des points ne se lisent pas en abonnements. Vos paliers sont gardés ; relisez leurs seuils, qui ne sont plus dans la même unité.

**En points.** Un bit vaut toujours un point. Les abonnements se règlent par trois cartes — *Points · Abonnements*, *Points · Réabonnements*, *Points · Sub offerts* — qui donnent le poids de chaque tier, Prime compris. Un lot de sub offerts ajoute les points de son tier multipliés par le nombre de sub. Le bouton *Copier vers…* au pied de chaque carte recopie ses valeurs dans les deux autres.

**Les valeurs de départ sont calées sur les prix**, pour qu'un euro de soutien pèse à peu près pareil quelle que soit sa forme :

| Soutien | Points |
| --- | --- |
| 1 bit | 1 |
| Abonnement ou réabonnement, Prime ou Tier 1 | 500 |
| Abonnement ou réabonnement, Tier 2 | 1 000 |
| Abonnement ou réabonnement, Tier 3 | 2 500 |
| Sub offert | 500, 1 000 ou 2 500 selon le tier, par sub offert |

Ce ne sont que des valeurs de départ pour les abonnements : réglez-les à votre main. Pour que les bits pèsent moins face aux abonnements, augmentez les points des abonnements ; pour qu'ils pèsent plus, baissez-les. Un poids à 0 retire ce type d'abonnement de la barre.

**En abonnements seuls.** Chaque abonnement, réabonnement ou sub offert compte pour 1, et les bits ne font pas avancer la barre. Les cartes *Subs · Abonnements*, *Subs · Réabonnements* et *Subs · Sub offerts* permettent de peser les tiers autrement — un Tier 3 pour 6, par exemple. Les points réglés pour l'autre façon de compter ne sont pas perdus : chaque façon garde ses propres poids.

**Une barre vous attend dès l'installation**, sur un premier palier à 1 000 points nommé « Objectif ». Renommez-le, changez son seuil, ajoutez-en d'autres ou supprimez-le : sans aucun palier, la page reste vide.

**Modifier le barème de points ne recalcule pas le compte en cours** : il ne vaut que pour les soutiens à venir.

**Le barème de points est indépendant du barème de temps.** Ce qu'un soutien ajoute au compteur et ce qu'il ajoute à la barre se règlent séparément : mettre les secondes des bits à 0 dans le barème n'empêche pas les bits de faire avancer la barre, et inversement.

**Le nom de l'unité.** Le champ *Nom de l'unité* dit ce que le panneau écrit après le compte — « points » ou « abo. » selon la façon de compter, et vous pouvez le changer. Il n'apparaît que dans le panneau : vos spectateurs lisent le nom du palier et « 620 / 1000 », sans unité.

**Ce qui ne compte pas** : la commande `!addtime`. C'est un crédit accordé à la main par un modérateur, et le faire gonfler une promesse affichée aux spectateurs la rendrait mensongère.

**L'échelle.** Dans la vue *Objectifs*, ajoutez un palier par promesse : un seuil, dans l'unité de votre barème de points, et le libellé qui dit la promesse, en quarante caractères au plus. Vous ne saisissez que la borne haute — la borne basse est celle du palier précédent, si bien qu'il ne peut y avoir ni trou ni chevauchement. L'ordre de saisie n'a pas d'importance : l'échelle est triée pour vous.

**Au-delà du dernier palier**, la barre reste pleine sur sa dernière promesse et le compte continue de monter. Rien ne repart à zéro tout seul.

**La remise à zéro** se trouve sur le tableau de bord, et demande deux clics : le premier arme, le second exécute. Elle n'efface **que** la progression des objectifs — votre compteur n'y touche pas, et l'inverse est vrai aussi : réinitialiser le chrono ne remet pas les objectifs à zéro. La progression est enregistrée dans son propre fichier et survit à la fermeture de l'application.

**Si vous veniez d'une version où la barre comptait en abonnements**, elle est restée telle quelle, en *Abonnements seuls*, avec son compte et ses paliers ; seuls les bits ont cessé de la faire avancer. Si vous êtes passé par la 1.4.0, elle a été remise à zéro en points à ce moment-là, ce qu'un encart du tableau de bord signale jusqu'à ce que vous le fermiez : vous pouvez revenir aux abonnements seuls depuis la carte *Ce que compte la barre*.

**Si votre subathon a commencé avant ChronoCast**, le champ *Compte déjà acquis*, sous l'échelle dans la vue *Objectifs*, cale la barre sur votre compte réel. La valeur saisie **remplace** le compte : elle ne s'y ajoute pas, elle n'annonce aucun palier à vos spectateurs même si elle en dépasse plusieurs, et elle ne crédite aucune seconde au compteur. Servez-vous-en pour rattraper un retard ou corriger une saisie, et non pour gonfler une promesse.

**Pour un soutien reçu hors de Twitch, ou une correction en cours de direct**, le champ *Ajuster la progression*, juste en dessous, ajoute ou retire un montant au compte, dans l'unité de la barre, comme la carte *Ajuster le compteur* le fait pour le temps. Un ajout qui franchit un palier l'annonce à vos spectateurs comme un soutien reçu de Twitch ; un retrait n'annonce rien, ne descend jamais sous zéro, et un palier repassé s'annoncera de nouveau quand le compte le refranchira. Aucun des deux ne crédite de seconde au compteur. Avec *Compte déjà acquis*, ce sont les seuls endroits où le compte affiché peut s'écarter de ce que ChronoCast a réellement vu passer.

#### Employer la barre seule, hors subathon

La barre ne dépend pas du compteur : elle sert à elle seule d'objectif mensuel, où abonnements, réabonnements, sub offerts, bits et Power-ups s'additionnent en points. Rien n'est à régler de plus que pour un subathon : écrivez vos paliers — 50 000, 100 000… — et **remettez la barre à zéro à la main en début de période**, depuis le tableau de bord. Rien ne repart à zéro tout seul le 1er du mois.

**Seuls les soutiens reçus pendant que ChronoCast est ouvert sont comptés.** L'application ne rattrape pas ce qui s'est passé pendant qu'elle était fermée : pour un objectif mensuel, laissez-la tourner pendant vos directs, et corrigez un écart avec le champ *Compte déjà acquis*.

**Un palier franchi ne crédite aucune seconde.** Le barème reste le seul juge du temps ajouté ; les objectifs disent *pourquoi* le compteur monte, ils ne le font pas monter.

**Ce que voient les spectateurs.** La page `/goal`, ajoutée dans OBS comme une seconde source navigateur — voir la section 4. Elle montre la promesse en cours et la progression ; à chaque palier franchi, un bandeau l'annonce quelques secondes avant de rendre la main au palier suivant. Un lot de sub offerts qui traverse plusieurs paliers les annonce l'un après l'autre. Son apparence — police, couleurs, forme de la barre, texte et durée de l'annonce — se règle dans la vue *Apparence*, onglet **Barre d'objectif**, et **l'overlay du compteur n'en est pas affecté**.

**Pour juger l'annonce sans attendre un vrai palier**, le bouton *Jouer une annonce* de cet onglet la rejoue sur le palier en cours. Elle s'affiche dans l'aperçu **et** dans la source ouverte dans OBS — c'est là que le rendu se juge — sans rien ajouter à votre progression.

## 6. Les dons hors Twitch

ChronoCast crédite ce que **Twitch** lui rapporte : subs, resubs, sub offerts, sub Prime, bits. C'est tout.

**Les Power-ups comptent comme des bits.** Un spectateur qui dépense des bits dans un Power-up — message animé, emote géante, célébration, ou Power-up personnalisé de votre chaîne — crédite le même temps qu'un cheer du même montant, selon le barème des bits, et fait avancer la barre d'objectif de la même façon. L'historique indique « en Power-up » à côté du montant. Un Power-up que vous déclenchez gratuitement sur votre propre chaîne ne compte pas : Twitch ne le signale pas. Aucune autorisation supplémentaire n'est demandée, vous n'avez pas à reconnecter votre chaîne.

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

### Mettre en pause depuis le chat : `!pause` et `!reprendre`

La même case **Lire le chat pour les commandes** active deux autres commandes, qui ne créditent rien mais arrêtent et relancent le décompte.

- `!pause` fige le compteur. Le temps restant ne bouge plus.
- `!reprendre` le relance là où il s'était arrêté.

**Elles sont réservées au diffuseur.** Un modérateur est ignoré, contrairement à `!addtime` : ajouter du temps est une faveur qu'on peut déléguer, arrêter le subathon n'en est pas une.

Leurs noms ne se règlent pas, et elles n'apparaissent nulle part dans le barème : il n'y a rien à configurer. Une pause déjà en cours ne se remet pas en pause, une reprise déjà en cours ne fait rien — vous pouvez taper deux fois sans conséquence. **Rien ne s'affiche sur l'overlay et rien n'entre dans l'historique** : le compteur qui se fige est le retour, et la vue *Tableau de bord* affiche **En pause**.

Une fois le subathon terminé, `!reprendre` ne le relance pas : passez par le *Tableau de bord*.

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

**Couper tout accès de ChronoCast à votre compte Twitch.** Le bouton *Révoquer l'accès* de la vue *Twitch* invalide le jeton d'accès auprès de Twitch et efface tous les identifiants de votre machine. Twitch ne permet pas à une application de révoquer elle-même le lien avec votre compte : pour le rompre, ouvrez `twitch.tv/settings/connections` et déconnectez ChronoCast. Si vous pensez que vos identifiants ont pu fuiter, faites-le, puis générez un nouveau secret client dans la console développeur de Twitch.

**Après avoir changé de PC ou de compte Windows**, les jetons deviennent illisibles : Windows les a chiffrés pour l'ancien compte. ChronoCast rouvre alors son assistant. Vos réglages et votre compteur, eux, sont intacts.

Pour tout le reste, la vue *Journaux* dit ce qui s'est passé. Les secrets y sont masqués : vous pouvez la copier telle quelle dans un rapport de bug.
