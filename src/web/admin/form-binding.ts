/**
 * Liaison déclarative entre les champs du panneau et la configuration.
 *
 * Le schéma compte environ soixante-dix réglages. Les câbler un à un
 * produirait soixante-dix fois la même séquence — lire le champ, convertir,
 * comparer à l'existant, reconstruire l'objet imbriqué — et donc autant
 * d'occasions de se tromper d'un caractère sans que rien ne le signale avant
 * l'exécution. Une description remplace ce code, et deux fonctions le rendent.
 *
 * **Ce module ne connaît pas le DOM.** La vue lui remet des valeurs brutes
 * indexées par sélecteur, il rend un fragment de configuration et la liste des
 * saisies fautives. C'est ce qui le rend testable sans navigateur, comme le
 * reste de la logique du front.
 *
 * Deux propriétés le gouvernent :
 *
 * - **seuls les champs modifiés sortent.** Renvoyer les soixante-dix à chaque
 *   enregistrement écraserait une valeur changée entre-temps depuis un autre
 *   onglet, ou par l'assistant resté ouvert dans une fenêtre voisine ;
 * - **rien ne part tant qu'une saisie est fautive.** Le serveur reste le juge —
 *   Zod refusera de toute façon — mais un enregistrement partiel laisserait
 *   l'utilisateur croire au succès, et un `400` générique pour une virgule
 *   décimale gâcherait le soin mis dans les messages du serveur.
 *
 * **Hors de portée, délibérément :** les réglages à cardinalité variable, comme
 * `rewards.bits.tiers`. Un tableau d'objets qu'on ajoute et retire n'est pas un
 * champ ; sa vue le gère pour elle-même.
 */

/* -------------------------------------------------------------------------- */
/* Description des champs                                                      */
/* -------------------------------------------------------------------------- */

export type FieldKind = 'integer' | 'number' | 'boolean' | 'text' | 'enum' | 'color';

export interface FieldDescriptor {
  /** Sélecteur CSS du champ. Sert aussi de clé dans les valeurs brutes. */
  readonly selector: string;
  /** Chemin pointé dans la configuration, par exemple `rewards.sub.tier1`. */
  readonly path: string;
  readonly kind: FieldKind;
  /** Bornes, alignées sur celles du schéma Zod. */
  readonly min?: number;
  readonly max?: number;
  /** Valeurs admises, pour `kind: 'enum'`. */
  readonly options?: readonly string[];

  /**
   * Autorise un `kind: 'text'` laissé vide.
   *
   * Le défaut refuse le vide, et c'est ce qu'il faut presque partout : une
   * police ou une URL vide n'a pas de sens, et le dire sous le champ vaut mieux
   * que de laisser Zod le refuser plus tard. Un réglage existe cependant pour
   * lequel le vide **est** la valeur voulue — le libellé de la bulle, où il
   * signifie « pas de libellé ». Sans cette échappatoire, il n'y aurait aucun
   * moyen d'éteindre l'annonce depuis le panneau.
   */
  readonly allowEmpty?: boolean;
}

/** Ce qu'un champ peut rendre : une chaîne, ou l'état d'une case à cocher. */
export type RawValue = string | boolean;

export interface FieldError {
  readonly selector: string;
  readonly path: string;
  /** Phrase française, affichable telle quelle sous le champ. */
  readonly message: string;
}

export interface PatchResult {
  /** Fragment imbriqué, prêt pour `PATCH /api/config`. Vide si rien n'a changé. */
  readonly patch: Record<string, unknown>;
  readonly errors: readonly FieldError[];
}

/* -------------------------------------------------------------------------- */
/* Parcours par chemin                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Segments interdits.
 *
 * Les descripteurs sont statiques et aucun ne porte ces noms : la garde ne
 * protège donc de rien aujourd'hui. Elle coûte trois lignes et ferme
 * définitivement la question, exactement comme `sanitize()` le fait côté
 * serveur avant validation.
 */
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Découpe un chemin, en refusant tout ce qui n'est pas exploitable. */
function segmentsOf(path: string): string[] {
  const segments = path.split('.');

  if (segments.length === 0 || segments.some((segment) => segment === '')) {
    throw new Error(`chemin de configuration malformé : ${path}`);
  }

  return segments;
}

/**
 * Lit une valeur imbriquée.
 *
 * Ne remonte jamais la chaîne de prototypes : sans `hasOwn`, `readAtPath({},
 * 'constructor')` rendrait la fonction `Object`, et `toString` une fonction —
 * de quoi faire apparaître du code dans un champ de formulaire.
 */
export function readAtPath(source: unknown, path: string): unknown {
  let current: unknown = source;

  for (const segment of segmentsOf(path)) {
    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

/** Écrit une valeur imbriquée, en créant les niveaux manquants. */
export function writeAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = segmentsOf(path);

  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
    // Erreur de programmation, pas saisie utilisateur : elle doit lever plutôt
    // que produire un objet silencieusement pollué.
    throw new Error(`segment de chemin interdit : ${path}`);
  }

  // Le dernier segment est extrait par déstructuration plutôt que par index :
  // `segmentsOf` garantit qu'il y en a au moins un, mais TypeScript l'ignore,
  // et l'affirmer par un `!` est interdit ici — à raison, puisque la garantie
  // vivrait alors dans un autre fichier que la promesse.
  const leaf = segments.pop();
  if (leaf === undefined) {
    throw new Error(`chemin de configuration malformé : ${path}`);
  }

  let current = target;

  for (const segment of segments) {
    const next = current[segment];
    if (!isPlainObject(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  current[leaf] = value;
}

/* -------------------------------------------------------------------------- */
/* Lecture vers les champs                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Valeurs à écrire dans les champs, depuis la configuration.
 *
 * Un chemin absent est **omis** plutôt que rendu vide : une configuration
 * d'une version antérieure peut ne pas porter un réglage ajouté depuis, et
 * écrire « undefined » dans le champ serait pire que de le laisser tel quel.
 */
export function valuesFrom(
  descriptors: readonly FieldDescriptor[],
  config: unknown,
): Record<string, RawValue> {
  const values: Record<string, RawValue> = {};

  for (const descriptor of descriptors) {
    const value = readAtPath(config, descriptor.path);

    if (typeof value === 'boolean') {
      values[descriptor.selector] = value;
    } else if (typeof value === 'number' || typeof value === 'string') {
      values[descriptor.selector] = String(value);
    }
    // Tout le reste — absent, objet, tableau — est omis. `String()` sur un
    // objet rendrait « [object Object] » dans un champ de saisie, ce qui est
    // pire qu'un champ laissé tel quel.
  }

  return values;
}

/* -------------------------------------------------------------------------- */
/* Écriture depuis les champs                                                  */
/* -------------------------------------------------------------------------- */

/** Notation hexadécimale, reprise telle quelle de `core/config/schema.ts`. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const INTEGER = /^-?\d+$/;

/** Résultat d'une conversion : une valeur, ou la raison du refus. */
type Converted = { ok: true; value: unknown } | { ok: false; message: string };

function withinBounds(value: number, descriptor: FieldDescriptor): Converted {
  if (descriptor.min !== undefined && value < descriptor.min) {
    return { ok: false, message: `Valeur minimale : ${String(descriptor.min)}.` };
  }
  if (descriptor.max !== undefined && value > descriptor.max) {
    return { ok: false, message: `Valeur maximale : ${String(descriptor.max)}.` };
  }
  return { ok: true, value };
}

function convert(descriptor: FieldDescriptor, raw: RawValue): Converted {
  if (descriptor.kind === 'boolean') {
    // Une chaîne signalerait une case à cocher lue par `.value` au lieu de
    // `.checked` : « on » est alors toujours vrai, et le réglage ne se
    // décocherait jamais. Mieux vaut le voir ici qu'à l'usage.
    return typeof raw === 'boolean'
      ? { ok: true, value: raw }
      : { ok: false, message: 'Case à cocher attendue.' };
  }

  // Symétrique de la garde précédente : tout autre genre attend du texte, et
  // recevoir un booléen signalerait un descripteur mal typé.
  if (typeof raw === 'boolean') {
    return { ok: false, message: 'Valeur texte attendue.' };
  }

  const text = raw.trim();

  switch (descriptor.kind) {
    case 'integer': {
      if (!INTEGER.test(text)) {
        return { ok: false, message: 'Nombre entier attendu.' };
      }
      return withinBounds(Number(text), descriptor);
    }

    case 'number': {
      // La virgule est acceptée : un clavier français en produit une, et
      // refuser la saisie serait une régression d'ergonomie.
      const normalized = text.replace(',', '.');
      const value = Number(normalized);
      if (normalized === '' || !Number.isFinite(value)) {
        return { ok: false, message: 'Nombre attendu.' };
      }
      return withinBounds(value, descriptor);
    }

    case 'color':
      return HEX_COLOR.test(text)
        ? { ok: true, value: text }
        : { ok: false, message: 'Couleur hexadécimale attendue, par exemple #FFCC00.' };

    case 'enum':
      return descriptor.options?.includes(text) === true
        ? { ok: true, value: text }
        : { ok: false, message: 'Valeur hors des choix proposés.' };

    case 'text':
      return text === '' && descriptor.allowEmpty !== true
        ? { ok: false, message: 'Ce champ ne peut pas rester vide.' }
        : { ok: true, value: text };
  }
  // `boolean` n'apparaît pas ici : la garde du dessus l'a déjà retiré du type,
  // et TypeScript refuse une branche devenue inatteignable.
}

/**
 * Compare les valeurs saisies à la configuration en place.
 *
 * Renvoie le fragment des seuls champs modifiés, et la liste des saisies
 * fautives. Les deux ne coexistent jamais : dès qu'une erreur est trouvée, le
 * fragment est vide — un enregistrement partiel laisserait croire au succès.
 *
 * Un sélecteur absent de `raw` est ignoré : une vue ne montre qu'une partie des
 * descripteurs, et les autres ne doivent pas être vus comme vidés.
 */
export function patchFrom(
  descriptors: readonly FieldDescriptor[],
  raw: Readonly<Record<string, RawValue>>,
  config: unknown,
): PatchResult {
  const patch: Record<string, unknown> = {};
  const errors: FieldError[] = [];

  for (const descriptor of descriptors) {
    const value = raw[descriptor.selector];

    // Un sélecteur absent est ignoré : une vue ne rend que ses propres champs,
    // et les autres ne doivent pas passer pour vidés.
    if (value === undefined) {
      continue;
    }

    const converted = convert(descriptor, value);

    if (!converted.ok) {
      errors.push({
        selector: descriptor.selector,
        path: descriptor.path,
        message: converted.message,
      });
      continue;
    }

    if (converted.value !== readAtPath(config, descriptor.path)) {
      writeAtPath(patch, descriptor.path, converted.value);
    }
  }

  return errors.length > 0 ? { patch: {}, errors } : { patch, errors };
}
