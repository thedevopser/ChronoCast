# Personnaliser l'overlay

Tout se règle depuis la vue **Apparence** du panneau, dont l'aperçu **est l'overlay réel** : ce que vous y voyez est ce qu'OBS affichera. Il suit votre saisie **sans que vous ayez à enregistrer**. Quand les réglages ne suffisent plus, une feuille de style personnelle prend le relais.

---

## 1. Les réglages du panneau

| Groupe | Ce qu'il règle |
| --- | --- |
| **Texte du compteur** | Police, taille, graisse, interlettrage, couleur, alignement, affichage des jours au-delà de 24 h, masquage des heures sous une heure |
| **Dégradé** | Deux couleurs et un angle, applicables **aux chiffres, au cadre, ou aux deux** |
| **Cadre** | Épaisseur du trait, arrondi des coins, marges intérieures, couleur, remplissage et son opacité |
| **Ombre portée** | Couleur, flou, décalages |
| **Contour** | Trait qui cerne **les chiffres eux-mêmes**, à ne pas confondre avec le cadre |
| **Halo** | Lueur rayonnant autour des chiffres |
| **Animation** | Effet joué à chaque ajout de temps : aucun, flash, pulsation, secousse |
| **Bulles d'annonce** | Durée, couleur et taille de la bulle qui annonce l'auteur d'un ajout |

Chaque groupe se replie d'un clic sur son titre, et ceux dont l'interrupteur est éteint arrivent repliés. Un réglage que rien n'active plus — la couleur d'une ombre désactivée, l'arrondi d'un cadre absent — est **grisé et marqué « sans effet »**. Il reste modifiable : vous pouvez préparer une valeur avant d'allumer l'effet.

**Les polices doivent être installées sur votre machine.** ChronoCast ne télécharge rien : une police venue d'Internet ferait un compteur vide pendant plusieurs secondes au démarrage de la scène, et casserait le fonctionnement hors ligne. Indiquez une liste de repli, comme `Bebas Neue, Impact, sans-serif`.

### L'aperçu et l'overlay d'OBS ne changent pas au même moment

C'est la distinction à retenir, et elle est voulue.

- **L'aperçu du panneau suit chaque frappe**, sans enregistrement. Bougez un curseur, il bouge avec vous. Une valeur invalide ou un champ vidé en cours de saisie ne le fait pas clignoter : il garde la dernière valeur valable.
- **L'overlay d'OBS ne change qu'à l'enregistrement.** Vos tâtonnements ne passent donc jamais à l'antenne, même si vous réglez l'apparence en plein direct.
- Le bouton **« Voir une bulle »** joue une bulle d'annonce et l'effet d'ajout dans l'aperçu seul. Il ne crédite aucun temps et n'atteint pas vos spectateurs.

**Après enregistrement, rechargez la source dans OBS** : *Propriétés* de la source → **Actualiser le cache de la page actuelle**.

## 2. Le cadre et le dégradé

Le cadre est un **anneau** : par défaut son intérieur est parfaitement transparent et laisse voir la scène. Montez l'**opacité du remplissage** si vous voulez au contraire un fond derrière les chiffres.

Le dégradé a **deux cases indépendantes** — *sur les chiffres*, *sur le cadre*. Les couleurs et l'angle sont communs aux deux : c'est voulu, un cadre et des chiffres aux dégradés différents jurent presque toujours.

Pour reproduire le style le plus courant — anneau coloré, intérieur transparent :

| Réglage | Valeur |
| --- | --- |
| Cadre autour du compteur | coché |
| Dégradé sur le cadre | coché |
| Épaisseur du trait | 4 |
| Arrondi des coins | 18 |
| Opacité du remplissage | 0 |

## 3. La feuille de style personnelle

Quand un réglage manque, `custom.css` prend le relais. Elle est chargée **en dernier** et peut donc tout surcharger.

**Où :** `%USERPROFILE%\ChronoCast\custom.css`. Ce nom-là, cet endroit-là, et nulle part ailleurs.

**Comment l'activer :** vue *Apparence* → groupe *Texte du compteur* → case **« Charger custom.css depuis le répertoire de données »**. Tant qu'elle est décochée, le fichier n'est pas servi même s'il existe.

**Pour vérifier qu'elle est bien servie**, sans passer par OBS : ouvrez `http://127.0.0.1:3777/custom.css` dans un navigateur. Une 404 signifie que la case est décochée, que le fichier n'est pas au bon endroit, ou qu'il n'est pas lisible.

### Ce que vous pouvez viser

| Sélecteur | Élément |
| --- | --- |
| `.overlay` | Le conteneur, plein écran |
| `.frame` | L'enveloppe du compteur, qui porte le remplissage du cadre |
| `.frame::before` | Le trait du cadre lui-même |
| `.countdown` | Les chiffres |
| `.toast` | La bulle d'annonce |
| `.toast__user` | Le pseudonyme dans la bulle |
| `.toast__reward` | Le gain annoncé dans la bulle |

**La même feuille sert aussi la page `/goal`**, sous le même interrupteur : les deux sources navigateur se personnalisent d'un seul fichier, et rien n'oblige à viser les deux.

| Sélecteur | Élément de la page `/goal` |
| --- | --- |
| `.bar` | La barre, qui porte le fond, l'arrondi et le trait |
| `.bar__fill` | La part parcourue, dont la largeur suit la progression |
| `.bar__text` | Le texte inscrit dans la barre |
| `.bar__label` | Le libellé de la promesse en cours |
| `.bar__count` | Le compte « 12 / 50 » |
| `.announce` | Le bandeau d'un palier franchi |
| `.announce__text`, `.announce__label` | Le texte réglé, et le libellé du palier |

### Le piège des variables

Les réglages du panneau sont posés en **style en ligne** sur `:root`, par le JavaScript de la page. Or un style en ligne bat une feuille de style : redéclarer `--cc-color` dans `custom.css` **n'aura aucun effet**.

Deux issues :

```css
/* Soit on force la variable… */
:root {
  --cc-color: #ff0000 !important;
}

/* …soit — plus simple — on surcharge la propriété directement. */
.countdown {
  color: #ff0000;
}
```

La seconde forme gagne toujours, parce que `custom.css` est chargée après la feuille de l'overlay.

### Exemples

**Deux lignes de texte sous le compteur** — le HTML n'étant pas modifiable, on passe par un pseudo-élément :

```css
.frame::after {
  content: 'Subathon en cours';
  display: block;
  margin-top: 0.2em;
  font-family: var(--cc-font-family);
  font-size: 0.28em;
  color: #ffffffcc;
  text-align: center;
}
```

**Un fond en dégradé derrière les chiffres**, là où le remplissage du panneau ne propose qu'une couleur unie :

```css
.frame {
  background: linear-gradient(180deg, #1a1a2eee, #16213eee);
}
```

**Chiffres en dégradé animé** :

```css
.countdown {
  background-image: linear-gradient(90deg, #9146ff, #00e5ff, #9146ff);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: glisse 6s linear infinite;
}

@keyframes glisse {
  to {
    background-position: -200% 0;
  }
}
```

> **Attention si vous peignez les chiffres par un dégradé :** `background-clip: text` découpe **tout** le fond de l'élément à la forme des glyphes. Une couleur de fond posée sur `.countdown` disparaîtra donc avec. Mettez-la sur `.frame`.

### Ce qui ne marchera pas

**Aucune ressource distante.** Ni `@import url(https://…)`, ni police Google Fonts, ni image sur un CDN : la politique de sécurité de la page les bloque, et l'application doit fonctionner sans connexion. Une image peut être intégrée en `data:` URI.

**Aucun lien symbolique sortant.** `custom.css` doit être un vrai fichier dans le répertoire de données. Un lien pointant ailleurs est refusé — c'est ce qui empêche de faire servir `secrets.json`, son voisin immédiat.

**Aucun JavaScript.** Une feuille de style ne peut pas en contenir, et la page n'en accepterait pas d'autre que le sien.

## 4. Les variables disponibles

Elles sont posées par le panneau et lues par la feuille de l'overlay. Les connaître aide à comprendre ce qu'on surcharge.

| Variable | Rôle |
| --- | --- |
| `--cc-font-family`, `--cc-font-size`, `--cc-font-weight`, `--cc-letter-spacing` | Typographie |
| `--cc-color` | Couleur unie des chiffres |
| `--cc-text-fill`, `--cc-text-background` | Peinture des chiffres : couleur ou dégradé découpé |
| `--cc-text-align` | Alignement |
| `--cc-text-shadow` | Ombre portée **et** halo, empilés |
| `--cc-outline-width`, `--cc-outline-color` | Contour des glyphes |
| `--cc-frame-width`, `--cc-frame-radius`, `--cc-frame-padding-x`, `--cc-frame-padding-y` | Géométrie du cadre |
| `--cc-frame-background`, `--cc-frame-fill` | Trait du cadre, et remplissage intérieur |
| `--cc-animation-duration` | Durée de l'effet d'ajout |
| `--cc-toast-color`, `--cc-toast-font-size`, `--cc-toast-duration` | Bulles d'annonce |

Celles de la page `/goal` portent toutes le préfixe `--cc-goal-`, si bien qu'aucune ne peut heurter les précédentes :

| Variable | Rôle |
| --- | --- |
| `--cc-goal-font-family`, `--cc-goal-font-size`, `--cc-goal-font-weight`, `--cc-goal-letter-spacing` | Typographie |
| `--cc-goal-color`, `--cc-goal-text-fill`, `--cc-goal-text-background` | Peinture du texte : couleur unie ou dégradé découpé |
| `--cc-goal-text-align` | Alignement dans la barre |
| `--cc-goal-text-shadow` | Ombre portée **et** halo, empilés |
| `--cc-goal-outline-width`, `--cc-goal-outline-color` | Contour des lettres |
| `--cc-goal-bar-height`, `--cc-goal-bar-radius` | Géométrie de la barre |
| `--cc-goal-bar-fill`, `--cc-goal-bar-track` | Remplissage de la part parcourue, et fond de la barre |
| `--cc-goal-bar-border-width`, `--cc-goal-bar-border-color` | Trait de la barre |
| `--cc-goal-announce-color`, `--cc-goal-announce-duration` | Bandeau d'un palier franchi |
| `--cc-goal-progress` | Part parcourue du palier courant, entre 0 et 1. **Posée sur la barre à chaque abonnement** : la surcharger fige l'affichage |

## 5. Tester sans attendre un sub

La vue *Tableau de bord* permet d'ajouter du temps à la main, ce qui déclenche l'animation et la bulle. Pour un événement Twitch complet — pseudonyme, palier, montant — voir [TESTING-TWITCH-CLI.md](TESTING-TWITCH-CLI.md).
