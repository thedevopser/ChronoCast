/**
 * Audit du gabarit de l'assistant de première configuration.
 *
 * Trois risques, distincts de ceux de l'overlay.
 *
 * **Le jeton CSRF doit être là.** L'assistant ne fait presque que des
 * mutations : enregistrer les identifiants, lancer le flux OAuth, écrire le
 * barème. Sans le marqueur dans le gabarit, toutes échoueraient en `403` — et
 * le serveur refuse **avant** de résoudre la route, si bien que rien
 * n'indiquerait la cause. C'est l'exacte réciproque de l'overlay, où le
 * marqueur doit être absent.
 *
 * **La redirect URI affichée doit être la vraie.** L'assistant demande à
 * l'utilisateur de recopier cette adresse dans la console développeur Twitch,
 * qui la compare ensuite au caractère près. Si la constante du noyau changeait
 * sans que le gabarit suive, la connexion échouerait chez tous les nouveaux
 * utilisateurs, et le message de Twitch ne dirait pas pourquoi. Ce test relie
 * les deux.
 *
 * **Le lien sortant doit être inerte.** L'assistant est la seule page de
 * ChronoCast qui pointe vers l'extérieur. Un `target="_blank"` sans
 * `rel="noreferrer"` donne à la page ouverte un accès à `window.opener` et lui
 * transmet l'adresse locale de l'application au passage.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { OAUTH_REDIRECT_URI } from '../../src/core/app/application.js';

const SETUP_HTML = readFileSync(resolve(process.cwd(), 'src/web/setup/index.html'), 'utf8');
const parsed = new DOMParser().parseFromString(SETUP_HTML, 'text/html');

describe('jeton CSRF', () => {
  it('porte le marqueur que le serveur substitue', () => {
    const meta = parsed.querySelector('meta[name="chronocast-csrf"]');

    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toBe('__CHRONOCAST_CSRF__');
  });
});

describe('redirect URI', () => {
  it('affiche exactement celle que le noyau déclare à Twitch', () => {
    // Le seul lien mécanique entre ce que lit l'utilisateur et ce que
    // l'application envoie réellement dans l'URL d'autorisation.
    const shown = parsed.querySelector('#redirect-uri')?.textContent?.trim();

    expect(shown).toBe(OAUTH_REDIRECT_URI);
  });
});

describe('conformité à la CSP', () => {
  it('ne contient aucun script en ligne', () => {
    const inline = [...parsed.querySelectorAll('script')].filter(
      (element) => !element.hasAttribute('src'),
    );

    expect(inline).toHaveLength(0);
  });

  it('ne contient aucun style en ligne', () => {
    expect(parsed.querySelectorAll('style')).toHaveLength(0);
    expect(parsed.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('ne contient aucun gestionnaire d’événement en attribut', () => {
    const withHandlers = [...parsed.querySelectorAll('*')].filter((element) =>
      [...element.attributes].some((attribute) => attribute.name.startsWith('on')),
    );

    expect(withHandlers).toHaveLength(0);
  });

  it('ne contient aucun formulaire soumissible', () => {
    // `form-action 'none'` : une soumission serait bloquée sans un mot
    // d'explication, et l'utilisateur croirait avoir enregistré ses réglages.
    expect(parsed.querySelectorAll('form')).toHaveLength(0);
  });

  it('ne déclare que des boutons inertes', () => {
    // Un `<button>` sans `type` vaut `submit` : hors formulaire c'est sans
    // effet aujourd'hui, mais c'est une chausse-trappe pour la suite.
    const untyped = [...parsed.querySelectorAll('button')].filter(
      (element) => element.getAttribute('type') !== 'button',
    );

    expect(untyped).toHaveLength(0);
  });
});

describe('ressources', () => {
  it('ne charge aucun script ni aucune feuille distante', () => {
    const sources = [...parsed.querySelectorAll('script[src], link[href]')].map(
      (element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '',
    );

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.startsWith('/')).toBe(true);
    }
  });

  it('neutralise les liens sortants', () => {
    const external = [...parsed.querySelectorAll('a[href]')].filter((element) =>
      (element.getAttribute('href') ?? '').startsWith('http'),
    );

    expect(external.length).toBeGreaterThan(0);
    for (const link of external) {
      expect(link.getAttribute('rel')).toContain('noreferrer');
      expect(link.getAttribute('href')?.startsWith('https://')).toBe(true);
    }
  });
});
