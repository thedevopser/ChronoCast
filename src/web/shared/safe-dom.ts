/**
 * Écriture dans le DOM.
 *
 * **Seul module du front autorisé à toucher au document.** Cette exclusivité
 * n'est pas une convention de style : elle réduit à un unique fichier la
 * surface où une injection est possible, ce qui la rend relisible en entier.
 * `innerHTML`, `outerHTML`, `insertAdjacentHTML` et `document.write` sont par
 * ailleurs bannis mécaniquement par ESLint, y compris ici.
 *
 * Le contenu affiché par l'overlay est **choisi par des tiers non fiables** :
 * n'importe quel spectateur décide de son pseudonyme. Trois défenses, dans cet
 * ordre :
 *
 * 1. `textContent` exclusivement, jamais d'analyse HTML ;
 * 2. retrait des caractères de contrôle et des marques de direction, qui
 *    déforment l'affichage sans la moindre balise ;
 * 3. troncature par graphème, pour qu'un pseudo de deux mille caractères ne
 *    pousse pas le compteur hors de l'écran.
 */

/** Longueur maximale d'un texte venu de l'extérieur, en graphèmes. */
export const MAX_TEXT_LENGTH = 64;

/**
 * Plages de points de code retirées avant tout affichage.
 *
 * Décrites en hexadécimal, et non par une classe de caractères littérale : un
 * octet de contrôle écrit tel quel dans le source est invisible à la relecture,
 * indétectable dans une revue, et sa disparition accidentelle ne se verrait
 * nulle part.
 *
 * **U+200C et U+200D sont délibérément épargnés.** L'antiliant et le liant sont
 * légitimes en persan, en arabe et dans les écritures indiennes, et U+200D est
 * ce qui tient ensemble les emoji composés — le retirer ferait éclater une
 * famille en trois personnes. Ils ne permettent pas de tromper la lecture,
 * seulement de la lier : les interdire abîmerait des pseudos honnêtes pour un
 * gain nul.
 */
const UNSAFE_RANGES: readonly (readonly [number, number])[] = [
  /* Commandes C0, dont le retour à la ligne, la tabulation, et l'échappement
     qui introduit les séquences ANSI. */
  [0x00, 0x1f],
  /* Suppression et commandes C1. */
  [0x7f, 0x9f],
  /* Espace de largeur nulle. */
  [0x200b, 0x200b],
  /* Marques de gauche-à-droite et de droite-à-gauche. */
  [0x200e, 0x200f],
  /* Incorporations et forçages de direction. U+202E inverse le sens de lecture
     de tout ce qui suit : de quoi faire apparaître à l'écran un texte que
     personne n'a écrit, sans la moindre balise. */
  [0x202a, 0x202e],
  /* Liant sans chasse et opérateurs mathématiques invisibles. */
  [0x2060, 0x2064],
  /* Isolants de direction. */
  [0x2066, 0x2069],
  /* Indicateur d'ordre des octets, invisible mais compté dans la longueur. */
  [0xfeff, 0xfeff],
];

function isUnsafe(codePoint: number): boolean {
  return UNSAFE_RANGES.some(([from, to]) => codePoint >= from && codePoint <= to);
}

/** Marque de coupure. Compte dans la longueur : le plafond n'est jamais dépassé. */
const ELLIPSIS = '…';

/**
 * Découpe en graphèmes, c'est-à-dire en caractères tels qu'un lecteur les voit.
 *
 * Ni `slice`, qui séparerait la paire de substitution d'un emoji, ni un
 * étalement de la chaîne, qui découperait par point de code et ferait éclater
 * un emoji composé. `Intl.Segmenter` est le seul découpage qui corresponde à ce
 * qui est réellement affiché.
 */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(value: string): string[] {
  return [...segmenter.segment(value)].map((entry) => entry.segment);
}

/**
 * Texte venu de l'extérieur, rendu affichable.
 *
 * Fonction pure, donc vérifiable sans DOM.
 */
export function sanitizeText(value: string, maxLength: number): string {
  let cleaned = '';
  // `for...of` parcourt les points de code et non les unités UTF-16 : un emoji
  // traverse donc le filtre d'un seul tenant.
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && !isUnsafe(codePoint)) {
      cleaned += character;
    }
  }

  const units = graphemes(cleaned);
  if (units.length <= maxLength) {
    return cleaned;
  }

  return units.slice(0, maxLength - 1).join('') + ELLIPSIS;
}

/**
 * Écrit un texte dans un élément.
 *
 * `textContent` remplace l'intégralité du contenu par un unique nœud de texte.
 * Aucune analyse HTML n'a lieu : `<img onerror=…>` reste une suite de
 * caractères, et c'est toute la garantie recherchée.
 */
export function setText(target: Element, value: string, maxLength = MAX_TEXT_LENGTH): void {
  target.textContent = sanitizeText(value, maxLength);
}

/** Vide un élément de ses enfants, sans passer par une affectation de HTML. */
export function clearChildren(target: Element): void {
  target.replaceChildren();
}

/**
 * Élément attendu par le gabarit, ou une erreur explicite.
 *
 * Le HTML est le nôtre : une absence est un défaut de programmation, pas un cas
 * d'exécution. Échouer bruyamment au démarrage vaut mieux qu'un overlay muet
 * pendant six heures de direct.
 */
export function requireElement(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error(`élément introuvable dans le gabarit : ${selector}`);
  }
  return element;
}

/**
 * Applique des variables CSS sur un élément.
 *
 * La CSP interdit l'attribut `style` écrit dans le HTML comme la balise
 * `<style>`, mais elle ne couvre pas le CSSOM : `setProperty` est donc la seule
 * voie pour répercuter la configuration d'apparence de l'overlay sans assouplir
 * `style-src`.
 */
export function setCssVariables(
  target: ElementCSSInlineStyle,
  variables: Readonly<Record<string, string>>,
): void {
  for (const [name, value] of Object.entries(variables)) {
    if (!name.startsWith('--')) {
      // Une faute de frappe écrirait une propriété CSS réelle, et le défaut ne
      // se verrait qu'à l'écran, en direct.
      throw new Error(`nom de variable CSS attendu, reçu : ${name}`);
    }
    target.style.setProperty(name, value);
  }
}
