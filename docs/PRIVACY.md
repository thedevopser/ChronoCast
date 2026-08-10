# Politique de confidentialité de ChronoCast

**Dernière mise à jour :** 8 août 2026.

ChronoCast est un compteur de subathon pour Twitch, qui s'exécute **entièrement sur votre ordinateur**. Il n'y a ni compte ChronoCast, ni serveur ChronoCast, ni base de données ChronoCast.

Ce document décrit ce que l'application manipule, où cela reste, et à qui elle parle. Il est exigé par la certification du Microsoft Store ; il est écrit pour être lu.

---

## 1. Ce que ChronoCast ne fait pas

- **Aucune télémétrie.** Aucune statistique d'usage, aucun rapport de plantage, aucun identifiant d'installation n'est envoyé nulle part.
- **Aucun compte.** ChronoCast ne vous demande pas de vous inscrire, et ne connaît pas votre identité en dehors de celle que Twitch lui communique quand vous connectez votre chaîne.
- **Aucune publicité, aucun traceur, aucun partage avec des tiers.** Il n'y a personne à qui partager quoi que ce soit.
- **Aucune vente de données.** Il n'y a pas de données à vendre.

## 2. Ce que ChronoCast conserve, et où

Tout est écrit dans un seul répertoire de votre profil Windows :

```
%USERPROFILE%\ChronoCast\
```

Il contient :

| Fichier | Contenu |
| --- | --- |
| `config.json` | Vos réglages : barème, apparence de l'overlay, port du serveur local |
| `counter.json` | L'état du compteur : temps restant, en marche ou en pause |
| `secrets.json` | Vos jetons d'accès Twitch, **chiffrés** |
| `history/` | Les événements ayant crédité du temps : type, pseudonyme, durée |
| `logs/` | Les journaux de fonctionnement, où les secrets sont masqués |

**Ces fichiers ne quittent jamais votre machine.** Aucune sauvegarde en ligne, aucune synchronisation.

**Les jetons Twitch sont chiffrés par DPAPI**, le mécanisme de Windows qui lie un secret à votre compte utilisateur. Un autre compte sur la même machine ne peut pas les lire, et une copie du fichier sur une autre machine est inutilisable.

**Vous pouvez tout supprimer** en effaçant ce répertoire. ChronoCast repartira d'une configuration neuve au lancement suivant. La désinstallation, elle, **ne l'efface pas** : c'est délibéré, pour qu'un subathon en cours survive à une réinstallation.

## 3. À qui ChronoCast parle

Uniquement à **Twitch**, et uniquement quand vous avez connecté votre chaîne :

| Hôte | Pourquoi |
| --- | --- |
| `id.twitch.tv` | Autorisation OAuth et renouvellement des jetons |
| `api.twitch.tv` | API Helix : vérification des abonnements aux événements |
| `eventsub.wss.twitch.tv` | Flux temps réel des abonnements, dons et messages de chat |

**Et à personne d'autre.** ChronoCast ne contacte aucun serveur de l'auteur, aucun service d'analyse, aucun réseau de diffusion de contenu. Les mises à jour sont gérées par le Microsoft Store, pas par l'application.

### Les liens vers l'extérieur

Le panneau d'administration et l'assistant de configuration proposent des liens vers le dépôt du projet, la console développeur de Twitch et une page de soutien PayPal. **Ces liens n'engendrent aucune requête de la part de ChronoCast** : cliquer ouvre votre navigateur, et l'application ne sait ni si vous avez cliqué, ni ce que vous faites ensuite. Aucune fonctionnalité n'est réservée à qui donne, et aucun paiement n'est traité par l'application.

## 4. Ce que Twitch communique à ChronoCast

Quand vous autorisez l'application, Twitch lui transmet, pour votre chaîne :

- les **abonnements**, réabonnements et abonnements offerts ;
- les **dons de bits** ;
- les **messages de chat**, nécessaires à la commande `!addtime`.

De ces données, ChronoCast retient dans son historique le **pseudonyme** de la personne à l'origine de l'événement, le type d'événement et le temps crédité. Le contenu des messages de chat n'est **pas** conservé : seule la commande reconnue l'est, sous forme d'un nombre de secondes.

**Les portées OAuth demandées sont le minimum nécessaire** à ce qui précède. Vous pouvez révoquer l'accès à tout moment, depuis le panneau de ChronoCast ou depuis les paramètres de connexion de votre compte Twitch.

## 5. Le serveur local

ChronoCast ouvre un serveur HTTP sur la **boucle locale** (`127.0.0.1`) pour servir l'overlay à OBS et le panneau d'administration.

Ce serveur **n'est pas accessible depuis Internet** ni depuis votre réseau local : il n'écoute que sur l'adresse de bouclage, qui ne sort pas de la machine. Aucun port n'est ouvert sur votre routeur, et ChronoCast ne vous demandera jamais de le faire.

## 6. Les enfants

ChronoCast n'est pas destiné aux enfants et ne collecte sciemment aucune donnée les concernant. C'est un outil de production pour diffuseurs.

## 7. Modifications de cette politique

Toute modification sera publiée dans ce fichier, avec sa date, et l'historique complet reste consultable dans [l'historique Git du dépôt](https://github.com/TheDevOpser/ChronoCast/commits/main/docs/PRIVACY.md).

## 8. Contact

Ouvrez une issue sur [le dépôt GitHub](https://github.com/TheDevOpser/ChronoCast/issues).

Pour le détail technique de ce qui précède — modèle de menace, contrôles, tests de sécurité — voir [SECURITY.md](SECURITY.md).
