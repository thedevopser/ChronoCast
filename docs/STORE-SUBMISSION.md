# Déposer ChronoCast dans Partner Center

Ce document rassemble les textes à coller dans les formulaires de soumission. Il complète [RELEASE.md](RELEASE.md), qui décrit la marche à suivre ; on vient ici pour le contenu, pas pour la procédure.

**Les paragraphes tiennent sur une seule ligne**, sans retour à la ligne dur : ces textes sont faits pour être copiés-collés dans des champs de formulaire, où un texte pré-coupé arrive avec des césures au milieu des phrases.

---

## 1. Approbation de `runFullTrust`

Partner Center détecte la fonctionnalité restreinte `runFullTrust` dans le manifeste et demande une justification avant de laisser la soumission avancer. C'est **routinier pour toute application Electron** : le Desktop Bridge n'a pas d'autre mode de fonctionnement.

**Le champ est limité à 500 caractères**, et il tronque en silence — le texte se coupe sans que rien ne le signale. Les deux versions ci-dessous font 494 caractères : ne rien y ajouter sans en retirer autant.

**Le point qui emporte la décision est le serveur de boucle locale**, parce qu'il décrit un besoin concret et vérifiable. « C'est une application Electron » se lit comme une formalité ; « OBS ne pourrait pas atteindre l'overlay » se vérifie. C'est pourquoi il survit à la coupe, là où la protection des jetons et la tâche de démarrage n'y survivent pas.

### Version anglaise — à privilégier

L'équipe de certification travaille en anglais, même quand Partner Center s'affiche en français.

```
ChronoCast is an Electron Win32 desktop app packaged with the Desktop Bridge, not a UWP app: runFullTrust is required to run its Chromium and Node.js processes. It also serves a timer overlay over HTTP and WebSocket on 127.0.0.1, read by OBS Studio, a separate process, as a Browser Source. AppContainer network isolation would block that and the app would not work. No elevation, no admin rights, no inbound port. Outbound traffic goes to Twitch only. Source: github.com/TheDevOpser/ChronoCast
```

### Version française

```
ChronoCast est une application de bureau Win32 bâtie avec Electron et empaquetée par le Desktop Bridge, et non une application UWP : runFullTrust est nécessaire à l'exécution de ses processus Chromium et Node.js. Elle sert un overlay en HTTP et WebSocket sur 127.0.0.1, lu par OBS Studio, un processus distinct, comme source Navigateur ; l'isolation réseau d'AppContainer l'en empêcherait. Aucune élévation, aucun droit administrateur, aucun port entrant. Trafic sortant vers Twitch uniquement.
```

### Si un relecteur demande des précisions

Le champ ne les tient pas, mais elles peuvent servir dans un échange :

- **Protection des identifiants** : les jetons OAuth Twitch sont chiffrés par DPAPI via l'API `safeStorage` d'Electron, qui les lie au compte Windows courant.
- **Tâche de démarrage** : l'application déclare une extension `windows.startupTask`, qui exige le point d'entrée `Windows.FullTrustApplication`.
- **Réseau** : le serveur n'écoute que sur l'adresse de bouclage, aucun port entrant n'est ouvert, et les seules connexions sortantes vont vers `id.twitch.tv`, `api.twitch.tv` et `eventsub.wss.twitch.tv`.
- **Aucun pilote, aucun service, aucune élévation** n'est installé ni demandé.

---

## 2. Politique de confidentialité

Le champ exige une **URL HTTPS publique**, et elle doit résoudre au moment de la certification.

```
https://github.com/TheDevOpser/ChronoCast/blob/main/docs/PRIVACY.md
```

**Cette adresse est en 404 tant que la branche n'est pas fusionnée sur `main`.** Fusionner avant de remplir la fiche, ou pointer temporairement l'URL de la branche — qui cassera à sa suppression.

Le contenu est dans [PRIVACY.md](PRIVACY.md).

---

## 3. Notes aux testeurs

Le relecteur doit pouvoir constater que l'application fonctionne. Sans ces notes, il ouvre ChronoCast, tombe sur l'assistant de configuration Twitch, n'a pas de chaîne à connecter, et peut conclure que le produit ne fait rien.

```
ChronoCast counts down a Twitch "subathon" timer and serves it to OBS Studio as a browser overlay. No account is needed to evaluate the app.

On first launch a setup wizard asks for Twitch credentials. You can skip it: the timer, the admin panel and the overlay all work without Twitch. To verify the app:

1. Launch ChronoCast. The admin panel opens on 127.0.0.1.
2. Open the "Tableau de bord" (Dashboard) view. The timer shows 12:00:00.
3. Use the "Tester l'overlay" (Test overlay) buttons to inject a demo event. The timer increases and the event appears in the history.
4. Copy the overlay URL from the dashboard and open it in any browser to see what OBS would display.

Connecting a real Twitch channel requires a Twitch developer application owned by the user; it is not needed to evaluate the app.
```

---

## 4. Description du Store

**La marque Twitch se décrit comme une interopérabilité, jamais comme une affiliation.** ChronoCast fonctionne *avec* Twitch ; il n'en émane pas, et le laisser entendre est un motif de rejet.

```
ChronoCast est un compteur de subathon pour Twitch, pensé pour OBS.

Le principe d'un subathon : chaque abonnement, chaque don de bits, chaque raid ajoute du temps à un compte à rebours, et le direct continue tant qu'il reste des secondes au compteur.

ChronoCast s'occupe de tout : il écoute les événements de votre chaîne, applique le barème que vous avez défini, et sert un overlay que vous collez dans une source Navigateur d'OBS.

• Barème réglable, par type d'événement et par palier de bits
• Overlay personnalisable, avec feuille de style maison si vous le souhaitez
• Commande de chat !addtime, réservée aux modérateurs et au diffuseur
• Panneau d'administration complet, dans votre navigateur
• Historique de tout ce qui a crédité du temps
• Le compteur survit à une fermeture, une coupure de courant, un redémarrage

Tout se passe sur votre machine. ChronoCast ne parle qu'à Twitch, ne collecte aucune donnée, et n'a ni compte ni serveur.

ChronoCast n'est pas affilié à Twitch ni à Amazon.
```

---

## 5. Le reste du formulaire

| Champ | Réponse |
| --- | --- |
| Catégorie | Outils de développement, ou Utilitaires et outils |
| Tarification | Gratuit |
| Marchés | Tous, ou France seule pour un premier essai |
| Classification par âge | Questionnaire IARC : aucun contenu généré par l'utilisateur affiché à des tiers, aucun achat, aucune publicité, aucune collecte de données |
| Captures d'écran | Celles de [images/](images/) conviennent |
| Contact de support | L'onglet Issues du dépôt |

### Le lien de soutien — à vérifier avant chaque soumission

Depuis la `0.9.0`, la vue « À propos » du panneau et la dernière étape de l'assistant proposent un lien vers une page PayPal. **Les politiques de certification du Store encadrent les mécanismes de paiement et les liens sortants : ce point est à revérifier dans les Microsoft Store Policies en vigueur avant chaque soumission.** Ce document ne cite volontairement aucun numéro de politique, qui changerait sans prévenir.

Les précautions déjà prises, à rappeler à un relecteur qui interrogerait :

- Le lien est présenté comme un **soutien facultatif au développement**, jamais comme un achat.
- **Aucune fonctionnalité n'est conditionnée à un don.** Rien n'est déverrouillé, rien n'est réservé, et les pages le disent explicitement.
- Le lien **ouvre le navigateur système** et non une vue intégrée : l'application ne traite aucun paiement et n'observe pas ce qui se passe ensuite.
- La réponse « aucun achat » au questionnaire IARC reste exacte : il n'y a ni achat intégré, ni contenu payant.

Si la certification refuse malgré tout, le repli est de retirer le lien des pages et de ne le laisser que dans le [README](../README.md) : `DONATION_URL` est défini au seul endroit [src/core/app/about.ts](../src/core/app/about.ts), et le test `tests/unit/assets/about.test.ts` signalera aussitôt les pages à corriger.

---

**Pour la première soumission, choisir une audience privée** restreinte à votre propre compte. Vous recevez alors le paquet réellement signé par Microsoft, installé depuis le Store, sans que personne d'autre ne le voie. C'est le seul moyen d'éprouver ce que recevront les utilisateurs. Voir la section 5 de [RELEASE.md](RELEASE.md) pour la liste d'essai.

---

## 6. Si la certification rejette

Le rejet du premier tour est probable et n'a rien d'inquiétant. Motifs fréquents : politique de confidentialité inaccessible, capture d'écran non conforme, description laissant croire à une affiliation, fonctionnalité restreinte insuffisamment justifiée.

Partner Center détaille le motif. Corrigez, redéposez : une nouvelle soumission ne demande pas de nouveau tag tant que le paquet n'a pas changé.
