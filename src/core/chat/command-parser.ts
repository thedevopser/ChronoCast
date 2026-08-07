/**
 * Analyseur d'une ligne de chat.
 *
 * Fonction pure et volontairement myope : elle ne connaît ni la configuration,
 * ni le compteur, ni la notion d'habilitation. Elle réduit un texte à un nom de
 * commande et un argument **brut**, ou à `null`.
 *
 * Ce découpage n'est pas cosmétique. Le service qui suit doit pouvoir refuser
 * une commande pour six raisons distinctes — désactivée, auteur non habilité,
 * argument absent, hors bornes… — et chacune doit se vérifier isolément. S'il
 * devait en plus démêler la syntaxe, aucune ne le serait.
 *
 * Le préfixe `!` est fixe et ne se règle pas : un réglage de plus est une
 * question de support de plus, l'argument même qui a fait retirer le mode
 * `separate` en V1.
 */

/** Commande reconnue, avant toute interprétation. */
export interface ParsedCommand {
  /** Nom sans le préfixe, ramené en minuscules. */
  readonly name: string;

  /**
   * Premier mot suivant le nom, tel qu'il a été tapé, ou `null`.
   *
   * Rendu brut et non converti : le seuil, le signe et le plafond dépendent de
   * la configuration, que ce module n'a pas à connaître.
   */
  readonly argument: string | null;
}

/** Préfixe des commandes. Fixe : voir l'en-tête du module. */
const PREFIX = '!';

/**
 * Caractère invisible apposé par Twitch aux messages en double.
 *
 * Twitch refuse qu'un même compte poste deux fois la même ligne d'affilée ; les
 * clients contournent cette limite en ajoutant `U+E0000`, de la zone à usage
 * privé, invisible à l'écran. Sans cette normalisation, la **seconde**
 * occurrence d'une commande ne serait jamais reconnue — un défaut qui ne se
 * manifeste qu'en direct, et dont la cause est introuvable à la lecture.
 */
const INVISIBLE_SUFFIX = /\u{E0000}/gu;

/**
 * Réduit une ligne de chat à une commande.
 *
 * @param text Message brut, d'origine réseau : jamais présumé conforme.
 */
export function parseCommand(text: string): ParsedCommand | null {
  if (typeof text !== 'string') {
    return null;
  }

  const cleaned = text.replace(INVISIBLE_SUFFIX, '').trim();
  if (!cleaned.startsWith(PREFIX)) {
    return null;
  }

  // Le nom est **collé** au préfixe, comme dans tous les bots de chat. Sans
  // cette exigence, « ! 300 » nommerait une commande « 300 » — une syntaxe que
  // personne n'a voulue, et qui rendrait le refus qui suit incompréhensible.
  const rest = cleaned.slice(PREFIX.length);
  if (rest === '' || /^\s/u.test(rest)) {
    return null;
  }

  const [name, argument] = rest.split(/\s+/u);
  if (name === undefined || name === '') {
    return null;
  }

  return { name: name.toLowerCase(), argument: argument ?? null };
}
