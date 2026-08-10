import { describe, expect, it } from 'vitest';

import { formatRemaining, formatReward } from '../../../../src/web/shared/time-format.js';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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
      expect(formatRemaining(1_999, DEFAULTS)).toBe('00:00:01');
    });

    it("n'affiche zéro que lorsqu'il ne reste plus une seconde entière", () => {
      expect(formatRemaining(999, DEFAULTS)).toBe('00:00:00');
      expect(formatRemaining(1_000, DEFAULTS)).toBe('00:00:01');
    });
  });

  describe('valeurs aberrantes', () => {
    it('traite une durée négative comme un compteur épuisé', () => {
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
    expect(formatReward(0)).toBe('+0 s');
  });

  it('signale un retrait par son signe', () => {
    expect(formatReward(-300)).toBe('-5 min');
  });
});
