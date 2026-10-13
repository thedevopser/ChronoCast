import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  formatLocalBound,
  nextOccurrence,
  resolveWindow,
} from '../../../../src/web/admin/next-occurrence.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Le module lit le fuseau de la machine : les tests le fixent sur une zone à changement d'heure.
const originalZone = process.env['TZ'];

beforeAll(() => {
  process.env['TZ'] = 'Europe/Paris';
});

afterAll(() => {
  if (originalZone === undefined) {
    delete process.env['TZ'];
  } else {
    process.env['TZ'] = originalZone;
  }
});

function paris(iso: string): number {
  return new Date(iso).getTime();
}

describe('nextOccurrence', () => {
  it('désigne ce soir une heure encore à venir', () => {
    expect(nextOccurrence('21:00', paris('2026-10-13T18:00:00+02:00'))).toBe(
      paris('2026-10-13T21:00:00+02:00'),
    );
  });

  it('désigne demain une heure déjà passée', () => {
    expect(nextOccurrence('21:00', paris('2026-10-13T22:00:00+02:00'))).toBe(
      paris('2026-10-14T21:00:00+02:00'),
    );
  });

  it('désigne demain l’heure exacte de l’instant courant', () => {
    expect(nextOccurrence('21:00', paris('2026-10-13T21:00:00+02:00'))).toBe(
      paris('2026-10-14T21:00:00+02:00'),
    );
  });

  it('passe la fin du mois et de l’année', () => {
    expect(nextOccurrence('00:15', paris('2026-12-31T23:50:00+01:00'))).toBe(
      paris('2027-01-01T00:15:00+01:00'),
    );
  });

  it.each(['', '24:00', '12:60', '9:00', '09h00', '09:00:30', 'midi'])(
    'ne résout pas la saisie « %s »',
    (time) => {
      expect(nextOccurrence(time, paris('2026-10-13T18:00:00+02:00'))).toBeNull();
    },
  );

  describe('changement d’heure', () => {
    // Nuit du 28 au 29 mars 2026 : à 02:00 il est 03:00, 02:30 n'existe pas.
    it('décale à 03:30 une heure qui n’existe pas cette nuit-là', () => {
      expect(nextOccurrence('02:30', paris('2026-03-28T22:00:00+01:00'))).toBe(
        paris('2026-03-29T03:30:00+02:00'),
      );
    });

    it('compte une journée de 23 heures quand la nuit en saute une', () => {
      const after = paris('2026-03-28T22:00:00+01:00');

      expect(nextOccurrence('21:00', after)).toBe(after + 22 * HOUR);
    });

    // Nuit du 24 au 25 octobre 2026 : à 03:00 il est de nouveau 02:00, 02:30 existe deux fois.
    it('retient la première des deux 02:30 de la nuit où elle se répète', () => {
      expect(nextOccurrence('02:30', paris('2026-10-24T22:00:00+02:00'))).toBe(
        paris('2026-10-25T02:30:00+02:00'),
      );
    });

    it('désigne le lendemain quand la première 02:30 est passée, sans viser la seconde', () => {
      expect(nextOccurrence('02:30', paris('2026-10-25T02:45:00+02:00'))).toBe(
        paris('2026-10-26T02:30:00+01:00'),
      );
    });
  });
});

describe('resolveWindow', () => {
  const SIX_PM = paris('2026-10-13T18:00:00+02:00');

  it('résout deux heures de la même soirée', () => {
    expect(resolveWindow('21:00', '23:00', SIX_PM)).toStrictEqual({
      startAt: paris('2026-10-13T21:00:00+02:00'),
      endAt: paris('2026-10-13T23:00:00+02:00'),
    });
  });

  it('place au lendemain du début une fin antérieure : 23:00 → 01:00 dure deux heures', () => {
    const window = resolveWindow('23:00', '01:00', SIX_PM);

    expect(window).toStrictEqual({
      startAt: paris('2026-10-13T23:00:00+02:00'),
      endAt: paris('2026-10-14T01:00:00+02:00'),
    });
    expect((window?.endAt ?? 0) - (window?.startAt ?? 0)).toBe(2 * HOUR);
  });

  it('place au lendemain du début une fin égale au début : vingt-quatre heures', () => {
    const window = resolveWindow('21:00', '21:00', SIX_PM);

    expect((window?.endAt ?? 0) - (window?.startAt ?? 0)).toBe(24 * HOUR);
  });

  it('résout la fin par rapport au début, et non par rapport à l’instant courant', () => {
    expect(resolveWindow('17:00', '17:30', SIX_PM)).toStrictEqual({
      startAt: paris('2026-10-14T17:00:00+02:00'),
      endAt: paris('2026-10-14T17:30:00+02:00'),
    });
  });

  it.each([
    ['', '23:00'],
    ['21:00', ''],
    ['21h', '23:00'],
  ])('ne résout rien quand une heure manque ou est illisible (%s, %s)', (start, end) => {
    expect(resolveWindow(start, end, SIX_PM)).toBeNull();
  });
});

describe('formatLocalBound', () => {
  const NOW = paris('2026-10-13T18:00:00+02:00');

  it('donne l’heure seule pour aujourd’hui', () => {
    expect(formatLocalBound(paris('2026-10-13T21:05:00+02:00'), NOW)).toBe('21:05');
  });

  it('dit « demain » pour le lendemain', () => {
    expect(formatLocalBound(paris('2026-10-14T01:00:00+02:00'), NOW)).toBe('demain 01:00');
  });

  it('donne le jour et le mois au-delà', () => {
    expect(formatLocalBound(paris('2026-10-16T09:30:00+02:00'), NOW)).toBe('le 16/10 à 09:30');
  });

  it('donne le jour pour une borne passée d’un autre jour', () => {
    expect(formatLocalBound(paris('2026-10-12T23:00:00+02:00'), NOW)).toBe('le 12/10 à 23:00');
  });

  it('dit « demain » juste après minuit, même à quelques minutes d’écart', () => {
    expect(
      formatLocalBound(paris('2026-10-14T00:05:00+02:00'), paris('2026-10-13T23:55:00+02:00')),
    ).toBe('demain 00:05');
  });
});
