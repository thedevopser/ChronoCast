import { describe, expect, it } from 'vitest';

import { configSchema } from '../../../../src/core/config/schema.js';
import { readGoalPreviewMessage } from '../../../../src/web/goal/preview.js';
import { PREVIEW_MESSAGE_TYPE } from '../../../../src/web/shared/preview.js';

const ORIGIN = 'http://127.0.0.1:3777';

const APPEARANCE = configSchema.parse({}).goals.overlay;

function envelope(overrides: Record<string, unknown> = {}): unknown {
  return { type: PREVIEW_MESSAGE_TYPE, kind: 'config', goalOverlay: APPEARANCE, ...overrides };
}

describe('readGoalPreviewMessage', () => {
  it('accepte un brouillon complet venu de la même origine', () => {
    expect(readGoalPreviewMessage({ origin: ORIGIN, data: envelope() }, ORIGIN)).toStrictEqual(
      APPEARANCE,
    );
  });

  // Une Browser Source d'OBS n'a pas de parent et n'expose rien ; seule une page de même origine
  // peut atteindre ce chemin, et la seule qui existe peut déjà écrire la configuration par l'API.
  it('refuse une autre origine', () => {
    expect(
      readGoalPreviewMessage({ origin: 'https://evil.example', data: envelope() }, ORIGIN),
    ).toBeNull();
  });

  it('refuse une enveloppe qui n’est pas la sienne', () => {
    expect(readGoalPreviewMessage({ origin: ORIGIN, data: { kind: 'config' } }, ORIGIN)).toBeNull();
    expect(
      readGoalPreviewMessage({ origin: ORIGIN, data: envelope({ kind: 'demo' }) }, ORIGIN),
    ).toBeNull();
  });

  it.each([null, undefined, 'texte', 42, []])('refuse une charge de forme %o', (data) => {
    expect(readGoalPreviewMessage({ origin: ORIGIN, data }, ORIGIN)).toBeNull();
  });

  // `goalCssVariables` lirait une branche absente : une forme incomplète signale une page qui
  // n'est pas celle qu'on croit, et il vaut mieux se taire que rendre l'aperçu illisible.
  it('refuse un brouillon amputé d’une branche', () => {
    const { bar: _bar, ...amputé } = APPEARANCE;

    expect(
      readGoalPreviewMessage({ origin: ORIGIN, data: envelope({ goalOverlay: amputé }) }, ORIGIN),
    ).toBeNull();
  });

  it('refuse un brouillon dont une feuille a le mauvais type', () => {
    const faussé = { ...APPEARANCE, fontSize: '28' };

    expect(
      readGoalPreviewMessage({ origin: ORIGIN, data: envelope({ goalOverlay: faussé }) }, ORIGIN),
    ).toBeNull();
  });

  it('refuse un brouillon dont une branche a le mauvais type', () => {
    const faussé = { ...APPEARANCE, announce: { ...APPEARANCE.announce, durationMs: 'longtemps' } };

    expect(
      readGoalPreviewMessage({ origin: ORIGIN, data: envelope({ goalOverlay: faussé }) }, ORIGIN),
    ).toBeNull();
  });
});
