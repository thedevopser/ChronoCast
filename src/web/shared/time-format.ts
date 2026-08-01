/**
 * Mise en forme du temps restant.
 *
 * Module pur, sans DOM et sans horloge : il reçoit un nombre de millisecondes
 * et rend une chaîne. C'est ce qui permet de couvrir au test tous les paliers
 * — franchissement du jour, de l'heure, du zéro — sans attendre une seconde.
 *
 * La règle qui gouverne tout le reste : **on tronque, jamais on n'arrondit au
 * supérieur**. L'overlay interpole le décompte localement entre deux diffusions
 * serveur, espacées d'une seconde ; un arrondi au supérieur ferait afficher une
 * seconde de plus que ce qui reste réellement, et la resynchronisation la
 * reprendrait aussitôt. Un compteur qui recule à l'écran est un défaut visible
 * par tout le monde, en direct.
 */

/** Sous-ensemble d'`OverlayConfig` dont dépend l'affichage du temps. */
export interface TimeFormatOptions {
  /** Sort les jours dans un segment distinct au-delà de vingt-quatre heures. */
  readonly showDays: boolean;
  /** Retire le segment des heures tant que le compteur reste sous une heure. */
  readonly hideEmptyHours: boolean;
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_DAY = 86_400;

/** Deux chiffres, toujours : sans quoi la largeur du texte varie à chaque seconde. */
function pad(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value);
}

/**
 * Millisecondes vers secondes entières restantes.
 *
 * Les valeurs aberrantes sont ramenées à zéro plutôt que propagées : une
 * interpolation qui a dépassé le zéro, ou un `NaN` venu d'un message malformé,
 * ne doit pas produire `-1:-1:-1` ni `NaN:NaN:NaN` dans une Browser Source que
 * personne ne surveille.
 */
function wholeSecondsLeft(remainingMs: number): number {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return 0;
  }
  return Math.floor(remainingMs / 1_000);
}

/** Temps restant tel qu'il doit apparaître à l'écran. */
export function formatRemaining(remainingMs: number, options: TimeFormatOptions): string {
  const total = wholeSecondsLeft(remainingMs);

  // Les jours ne sont extraits que si le réglage l'autorise. Sinon les heures
  // cumulent au-delà de vingt-quatre : un subathon de trois jours affiche
  // « 72:00:00 » et non « 00:00:00 », qui laisserait croire à la fin.
  const days = options.showDays ? Math.floor(total / SECONDS_PER_DAY) : 0;
  const rest = total - days * SECONDS_PER_DAY;

  const hours = Math.floor(rest / SECONDS_PER_HOUR);
  const minutes = Math.floor((rest % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = rest % SECONDS_PER_MINUTE;

  if (options.hideEmptyHours && days === 0 && hours === 0) {
    return `${pad(minutes)}:${pad(seconds)}`;
  }

  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${String(days)}j ${clock}` : clock;
}

/**
 * Temps crédité par un événement, tel qu'il apparaît dans une bulle.
 *
 * Une bulle se lit d'un coup d'œil, en périphérie d'un direct. Elle porte donc
 * une grandeur et non un chronomètre : « +5 min » se saisit instantanément, là
 * où « +00:05:00 » demande de compter les segments.
 *
 * Le signe est explicite dans les deux sens. Un retrait n'a pas vocation à être
 * annoncé au spectateur, mais le panneau d'administration réutilise ce
 * formatage pour l'historique, où les deux existent.
 */
export function formatReward(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return '+0 s';
  }

  const sign = seconds < 0 ? '-' : '+';
  const total = Math.abs(Math.trunc(seconds));

  if (total < SECONDS_PER_MINUTE) {
    return `${sign}${String(total)} s`;
  }

  if (total < SECONDS_PER_HOUR) {
    const minutes = Math.floor(total / SECONDS_PER_MINUTE);
    const rest = total % SECONDS_PER_MINUTE;
    return rest === 0
      ? `${sign}${String(minutes)} min`
      : `${sign}${String(minutes)} min ${pad(rest)}`;
  }

  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return minutes === 0 ? `${sign}${String(hours)} h` : `${sign}${String(hours)} h ${pad(minutes)}`;
}
