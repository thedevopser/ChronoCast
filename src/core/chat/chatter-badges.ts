/**
 * Habilitation d'un auteur de message, lue sur ses badges.
 *
 * **L'habilitation se lit sur le badge, jamais sur le pseudo.** Le badge est
 * une donnée que Twitch pose lui-même dans la charge utile ; le pseudo est une
 * chaîne qu'un spectateur choisit, et qu'il peut faire ressembler à s'y
 * méprendre à celui d'un modérateur.
 *
 * Aucun appel Helix, aucune portée de modération : `channel.chat.message`
 * transporte déjà l'information.
 *
 * Ce module ne lève jamais et refuse par défaut. La charge utile vient du
 * réseau : ne pas savoir qui parle ne vaut pas l'autorisation de créditer du
 * temps, et une exception ici abattrait le traitement de la notification.
 */

/** `set_id` des badges qui ouvrent les commandes. */
const PRIVILEGED_BADGES: ReadonlySet<string> = new Set(['broadcaster', 'moderator']);

/**
 * Vrai si l'auteur porte le badge de diffuseur ou de modérateur.
 *
 * @param badges Tableau `badges` de la charge utile, jamais présumé conforme.
 */
export function isPrivileged(badges: unknown): boolean {
  if (!Array.isArray(badges)) {
    return false;
  }

  return badges.some((badge) => {
    if (typeof badge !== 'object' || badge === null) {
      return false;
    }
    const setId = (badge as { set_id?: unknown }).set_id;
    // Comparaison sensible à la casse : Twitch écrit ses `set_id` en
    // minuscules, et accepter « Moderator » élargirait la porte sur la foi
    // d'une valeur qui n'existe pas.
    return typeof setId === 'string' && PRIVILEGED_BADGES.has(setId);
  });
}
