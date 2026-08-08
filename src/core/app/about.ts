/**
 * Paternité du projet et liens sortants.
 *
 * Ces valeurs sont figées à la compilation : elles ne transitent pas par le protocole
 * WebSocket comme `APP_VERSION`, elles sont écrites dans les pages et un test de cohérence
 * interdit la dérive. `navigation-policy` en dérive sa liste blanche, de sorte que changer
 * une URL ici suffit à autoriser l'hôte correspondant.
 */

export const AUTHOR = 'TheDevOpser';

export const COPYRIGHT_YEAR = '2026';

export const LICENSE_NAME = 'MIT';

export const REPOSITORY_URL = 'https://github.com/thedevopser/ChronoCast';

export const DONATION_URL = 'https://paypal.me/Gothdroid';
