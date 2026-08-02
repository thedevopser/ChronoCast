# Récupération après crash

**Le compteur survit à tout : fermeture brutale, écran bleu, coupure de courant.** C'est la promesse centrale du produit — un subathon perdu au bout de six heures parce que Windows a redémarré n'est pas rattrapable, et aucune excuse ne le rendrait acceptable.

Ce document explique comment cette promesse est tenue, ce que vous perdez au pire, et quoi faire dans les rares cas où l'état est illisible.

---

## 1. Ce que vous perdez au pire : cinq secondes

Deux natures d'écriture cohabitent, et cette distinction est tout le mécanisme.

**Les mutations sont écrites immédiatement.** Un sub qui crédite, un ajout manuel, une pause : l'état part sur le disque au moment même. Aucun événement Twitch ne peut être perdu par un crash.

**L'érosion du temps qui passe est écrite périodiquement**, toutes les cinq secondes par défaut (`counter.persistIntervalMs`). Écrire à chaque battement — quatre fois par seconde — userait le disque pour rien.

Conséquence : un crash vous fait perdre au maximum le dernier intervalle de décompte, **et toujours en votre faveur**. L'état retrouvé est celui d'il y a cinq secondes, donc légèrement plus généreux que la réalité. Jamais l'inverse.

Vous pouvez descendre cet intervalle dans *Paramètres* si vous préférez. Le compromis est simple : plus court, moins de perte, plus d'écritures.

## 2. Comment l'écriture résiste à une coupure

Le scénario redouté n'est pas le crash lui-même, c'est la coupure **en pleine écriture** : un `writeFile` direct laisse alors un fichier tronqué, donc un JSON invalide, donc un compteur perdu.

Chaque enregistrement suit donc trois temps :

1. l'état est écrit dans un fichier **temporaire**, puis `fsync` le pousse réellement sur le plateau — et non dans le cache du système, où une coupure l'effacerait ;
2. la version courante est recopiée en **`.bak`** ;
3. `rename` substitue le temporaire au fichier principal. **C'est une opération atomique**, sur NTFS comme ailleurs : à aucun instant le fichier n'est à moitié écrit. Soit l'ancien, soit le nouveau.

Le fichier principal ne disparaît donc jamais, même une fraction de seconde.

## 3. Comment la lecture se rattrape

Au démarrage, toute anomalie déclenche un repli en cascade :

1. **`counter.json`** — s'il est lisible et valide, on repart dessus ;
2. **`counter.json.bak`** — la version précédente, au pire vieille d'un intervalle ;
3. **les valeurs par défaut** — le compteur repart de sa durée initiale.

Un fichier illisible est conservé sous le nom `counter.json.corrupt-<horodatage>` avant d'être écarté. Il n'est jamais supprimé : si le pire arrive, il reste quelque chose à examiner.

**Une lecture ne lève jamais.** Démarrer avec un compteur remis à zéro est déjà pénible ; refuser de démarrer serait pire, et priverait du panneau qui permet justement de corriger la valeur à la main.

## 4. Vérifier soi-même

L'exercice tient en une minute et vaut mieux qu'une promesse écrite.

1. Lancez ChronoCast, démarrez le compteur, notez le temps restant.
2. Tuez le processus **sans le laisser s'arrêter proprement** : gestionnaire des tâches → `ChronoCast.exe` → *Fin de tâche*.
3. Relancez.

Le temps restant doit être celui noté, à cinq secondes près et jamais moins. Le décompte reprend tout seul si `counter.resumeOnStartup` est actif, ce qui est le défaut.

## 5. Que faire si le compteur est reparti à zéro

C'est le cas le plus grave, et le plus rare : les deux fichiers étaient illisibles.

**Rien n'est perdu pour autant.** L'historique des événements, lui, est écrit ligne à ligne dans `%APPDATA%\ChronoCast\history\` — un format où une ligne corrompue n'emporte pas les autres. La vue *Historique* du panneau vous donne le total crédité depuis le début.

Pour remettre le compteur d'aplomb : *Tableau de bord* → **Ajouter du temps**, avec le montant reconstitué. Le geste est manuel, mais l'information nécessaire est là.

## 6. Ce que le crash ne touche pas

**Vos réglages** (`config.json`) sont écrits par le même mécanisme atomique, avec le même `.bak`.

**Vos jetons Twitch** (`secrets.json`) survivent également. En revanche, ils sont chiffrés **pour votre compte Windows** : les recopier vers un autre PC ou un autre compte les rend illisibles, et ChronoCast rouvrira son assistant. Ce n'est pas un défaut, c'est la protection qui empêche quiconque récupérant le fichier de s'en servir.

**Une écriture qui échoue n'interrompt pas le subathon.** Disque plein, antivirus qui verrouille le fichier : le compteur continue de tourner en mémoire et le panneau vous alerte. Mieux vaut un compteur juste à l'écran et une alerte qu'un arrêt en plein direct.

## 7. En cas de doute, les journaux

`%APPDATA%\ChronoCast\logs\`, également consultables depuis la vue *Journaux*. Au démarrage, ChronoCast y dit exactement d'où vient l'état qu'il a chargé : fichier principal, fichier de secours, ou valeurs par défaut. Les secrets y sont masqués, la copie est donc sans risque.
