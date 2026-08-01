/**
 * Formatage du temps restant affiché par l'overlay.
 *
 * Le risque couvert ici n'est pas cosmétique. Ce module est lu en continu par
 * le spectateur pendant des heures, et deux défauts se voient immédiatement :
 * un compteur qui affiche plus de temps qu'il n'en reste réellement, et un
 * compteur qui recule d'une seconde au franchissement d'un palier parce que
 * l'arrondi n'est pas cohérent avec l'interpolation locale.
 *
 * D'où la règle testée ici : on tronque, on n'arrondit jamais au supérieur.
 * L'affichage ne promet jamais de temps qui n'existe pas.
 *
 * Les deux réglages du schéma (`overlay.showDays`, `overlay.hideEmptyHours`)
 * sont des cas limites à part entière : ils changent le nombre de segments
 * affichés, donc la largeur du texte, en plein direct.
 */

import { describe, expect, it } from 'vitest';

import { formatRemaining, formatReward } from '../../../../src/web/shared/time-format.js';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Réglages par défaut du schéma : jours affichés, heures toujours visibles. */
const DEFAULTS = { showDays: true, hideEmptyHours: false } as const;

describe('formatRemaining', () => {
  describe('format de base', () => {
    it('affiche heures, minutes et secondes sur deux chiffres', () => {
      expect(formatRemaining(12 * HOUR, DEFAULTS)).toBe('12:00:00');
    });

    it('complète les segments à un chiffre par un zéro', () => {
      expect(formatRemaining(1 * HOUR + 2 * MINUTE + 3 * SECOND, DEFAULTS)).toBe('01:02:03');
    });

    it('affiche zéro quand le compteur est épuisé', () => {
      expect(formatRemaining(0, DEFAULTS)).toBe('00:00:00');
    });
  });

  describe('troncature', () => {
    it('tronque les millisecondes plutôt que de les arrondir au supérieur', () => {
      // 1 999 ms, c'est une seconde pleine et un reste : afficher « 2 »
      // promettrait une seconde que le compteur n'a pas.
      expect(formatRemaining(1_999, DEFAULTS)).toBe('00:00:01');
    });

    it("n'affiche zéro que lorsqu'il ne reste plus une seconde entière", () => {
      expect(formatRemaining(999, DEFAULTS)).toBe('00:00:00');
      expect(formatRemaining(1_000, DEFAULTS)).toBe('00:00:01');
    });
  });

  describe('valeurs aberrantes', () => {
    it('traite une durée négative comme un compteur épuisé', () => {
      // L'interpolation locale peut dépasser le zéro entre deux diffusions.
      expect(formatRemaining(-5_000, DEFAULTS)).toBe('00:00:00');
    });

    it('traite une valeur non finie comme un compteur épuisé', () => {
      expect(formatRemaining(Number.NaN, DEFAULTS)).toBe('00:00:00');
      expect(formatRemaining(Number.POSITIVE_INFINITY, DEFAULTS)).toBe('00:00:00');
    });
  });

  describe('showDays', () => {
    it('ajoute un segment de jours au-delà de vingt-quatre heures', () => {
      expect(formatRemaining(DAY + 12 * HOUR, DEFAULTS)).toBe('1j 12:00:00');
    });

    it("n'affiche pas de segment de jours en deçà de vingt-quatre heures", () => {
      expect(formatRemaining(23 * HOUR + 59 * MINUTE + 59 * SECOND, DEFAULTS)).toBe('23:59:59');
    });

    it('affiche exactement « 1j 00:00:00 » au franchissement du premier jour', () => {
      expect(formatRemaining(DAY, DEFAULTS)).toBe('1j 00:00:00');
    });

    it('cumule les heures au-delà de vingt-quatre quand les jours sont désactivés', () => {
      // Un subathon de trois jours affiche « 72:00:00 » et non « 00:00:00 » :
      // les heures ne doivent pas repartir de zéro à chaque jour.
      expect(formatRemaining(3 * DAY, { showDays: false, hideEmptyHours: false })).toBe('72:00:00');
    });
  });

  describe('hideEmptyHours', () => {
    it('masque les heures tant que le compteur reste sous une heure', () => {
      expect(formatRemaining(34 * MINUTE + 56 * SECOND, { ...DEFAULTS, hideEmptyHours: true })).toBe(
        '34:56',
      );
    });

    it('réaffiche les heures dès la première heure atteinte', () => {
      expect(formatRemaining(HOUR, { ...DEFAULTS, hideEmptyHours: true })).toBe('01:00:00');
    });

    it("garde les heures à zéro quand le réglage n'est pas actif", () => {
      expect(formatRemaining(34 * MINUTE, DEFAULTS)).toBe('00:34:00');
    });
  });
});

/**
 * Le temps crédité par un événement, tel qu'il apparaît dans une bulle.
 *
 * Une bulle se lit d'un coup d'œil, en périphérie d'un direct : elle porte une
 * grandeur, pas un chronomètre. « +5 min » se saisit instantanément, là où
 * « +00:05:00 » demande de compter les segments.
 */
describe('formatReward', () => {
  it('exprime en secondes en deçà de la minute', () => {
    expect(formatReward(30)).toBe('+30 s');
  });

  it('exprime en minutes rondes quand il n’y a pas de reste', () => {
    expect(formatReward(300)).toBe('+5 min');
  });

  it('ajoute les secondes restantes le cas échéant', () => {
    expect(formatReward(330)).toBe('+5 min 30');
  });

  it('passe aux heures au-delà de soixante minutes', () => {
    expect(formatReward(3_600)).toBe('+1 h');
    expect(formatReward(3_900)).toBe('+1 h 05');
  });

  it('affiche un crédit nul sans prétendre le contraire', () => {
    // Un événement non crédité — plafond atteint, barème à zéro — ne doit pas
    // annoncer un gain qui n'a pas eu lieu.
    expect(formatReward(0)).toBe('+0 s');
  });

  it('signale un retrait par son signe', () => {
    expect(formatReward(-300)).toBe('-5 min');
  });
});
