import { describe, expect, it } from 'vitest';

import { configSchema } from '../../src/core/config/schema.js';
import { normalizeLadder, positionAt } from '../../src/core/goals/goal-ladder.js';
import { normalizeGoalTiers } from '../../src/web/admin/goal-tiers.js';
import { setText } from '../../src/web/shared/safe-dom.js';

const HOSTILE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '"><script>alert(1)</script>',
  '<iframe src="javascript:a">',
  '<a href="javascript:alert(1)">x</a>',
  '</li></ul><script>a</script>',
  '<style>*{display:none}</style>',
  '<body onload=alert(1)>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
];

function paint(value: string): HTMLElement {
  const host = document.createElement('span');
  setText(host, value, 500);
  return host;
}

describe('libellé de palier hostile', () => {
  it.each(HOSTILE)('s’affiche en texte et n’engendre aucun élément : %o', (hostile) => {
    const host = paint(hostile);

    expect(host.querySelectorAll('*')).toHaveLength(0);
    expect(host.childNodes).toHaveLength(1);
    expect(host.childNodes[0]?.nodeType).toBe(host.TEXT_NODE);
    expect(host.textContent).toBe(hostile);
  });

  it.each(HOSTILE)('traverse le schéma sans être interprété : %o', (hostile) => {
    const label = hostile.slice(0, 40);
    const parsed = configSchema.parse({ goals: { tiers: [{ target: 50, label }] } });

    expect(paint(parsed.goals.tiers[0]?.label ?? '').querySelectorAll('*')).toHaveLength(0);
  });

  it.each(HOSTILE)('traverse l’échelle et la position sans être interprété : %o', (hostile) => {
    const label = hostile.slice(0, 40);
    const ladder = normalizeLadder([{ target: 50, label }]);

    expect(paint(positionAt(0, ladder).label).querySelectorAll('*')).toHaveLength(0);
  });

  it.each(HOSTILE)('traverse l’éditeur du panneau sans être interprété : %o', (hostile) => {
    const label = hostile.slice(0, 40);
    const { tiers, errors } = normalizeGoalTiers([{ target: '50', label }]);

    expect(errors).toEqual([]);
    expect(paint(tiers[0]?.label ?? '').querySelectorAll('*')).toHaveLength(0);
  });

  it('ne laisse passer aucun script à travers une échelle entière', () => {
    const ladder = normalizeLadder(
      HOSTILE.map((hostile, index) => ({ target: index + 1, label: hostile.slice(0, 40) })),
    );

    const host = document.createElement('ul');
    for (const tier of ladder) {
      const item = document.createElement('li');
      setText(item, tier.label, 500);
      host.append(item);
    }

    expect(host.querySelectorAll('script, img, svg, iframe, a, style')).toHaveLength(0);
    expect(host.querySelectorAll('li')).toHaveLength(ladder.length);
  });
});
