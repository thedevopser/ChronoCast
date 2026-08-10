import { describe, expect, it } from 'vitest';

import { filterHistory, formatDetail, type HistoryEntry } from '../../src/web/admin/history-view.js';
import { appendRecords, createLogBuffer, filterRecords, scopesOf, type LogRecord } from '../../src/web/admin/log-view.js';
import { setText } from '../../src/web/shared/safe-dom.js';

const HOSTILE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '"><script>alert(1)</script>',
  '<iframe src="javascript:alert(1)">',
  '<a href="javascript:alert(1)">clic</a>',
  '</li></ul><script>alert(1)</script>',
  '<style>*{display:none}</style>',
  '<body onload=alert(1)>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '<img src=x onerror="fetch(`/api/counter/reset`,{method:`POST`})">',
];

function entry(userName: string, reason = 'abonnement'): HistoryEntry {
  return {
    id: 'e1',
    type: 'sub',
    occurredAt: 1_000,
    recordedAt: 1_000,
    userId: 'u1',
    userName,
    source: 'eventsub',
    detail: 'tier1',
    rewardSeconds: 180,
    applied: true,
    reason,
    remainingMsAfter: 3_600_000,
  };
}

function paint(value: string, maxLength = 500): HTMLElement {
  const host = document.createElement('span');
  setText(host, value, maxLength);
  return host;
}

describe('pseudos hostiles dans l’historique', () => {
  it.each(HOSTILE)('n’engendre aucun élément pour %o', (hostile) => {
    const host = paint(entry(hostile).userName);

    expect(host.querySelectorAll('*')).toHaveLength(0);
    expect(host.childNodes).toHaveLength(1);
    expect(host.childNodes[0]?.nodeType).toBe(host.TEXT_NODE);
  });

  it.each(HOSTILE)('n’engendre aucun élément depuis le motif %o', (hostile) => {
    const host = paint(entry('alice', hostile).reason);

    expect(host.querySelectorAll('*')).toHaveLength(0);
  });

  it('ne laisse passer aucun script à travers le filtrage', () => {
    const entries = HOSTILE.map((hostile) => entry(hostile));
    const filtered = filterHistory(entries, {});

    for (const item of filtered) {
      expect(paint(item.userName).querySelectorAll('*')).toHaveLength(0);
    }
  });

  it('conserve le contenu hostile comme texte lisible', () => {
    const host = paint('<script>alert(1)</script>');

    expect(host.textContent).toContain('script');
  });

  it('n’interprète pas un détail hostile venu du disque', () => {
    const hostile = { ...entry('alice'), detail: '<img src=x onerror=alert(1)>' };
    const host = paint(formatDetail(hostile));

    expect(host.querySelectorAll('*')).toHaveLength(0);
  });
});

describe('messages hostiles dans les journaux', () => {
  function record(message: string, scope = 'twitch'): LogRecord {
    return { timestamp: '2026-08-02T06:00:00.000Z', level: 'info', scope, message };
  }

  it.each(HOSTILE)('n’engendre aucun élément pour le message %o', (hostile) => {
    const host = paint(record(hostile).message);

    expect(host.querySelectorAll('*')).toHaveLength(0);
  });

  it.each(HOSTILE)('n’engendre aucun élément pour la portée %o', (hostile) => {
    const host = paint(record('ok', hostile).scope, 80);

    expect(host.querySelectorAll('*')).toHaveLength(0);
  });

  it('n’interprète pas un contexte hostile sérialisé', () => {
    const context = {
      userName: '<img src=x onerror=alert(1)>',
      nested: { html: '<a href="javascript:alert(1)">clic</a>' },
    };
    const host = paint(JSON.stringify(context, null, 2), 2_000);

    expect(host.querySelectorAll('*')).toHaveLength(0);
    expect(host.childNodes).toHaveLength(1);
  });

  it('ne laisse passer aucun script à travers le tampon et le filtrage', () => {
    const buffer = appendRecords(createLogBuffer(), HOSTILE.map((hostile) => record(hostile)));
    const filtered = filterRecords(buffer.records, {});

    expect(filtered).toHaveLength(HOSTILE.length);
    for (const item of filtered) {
      expect(paint(item.message).querySelectorAll('*')).toHaveLength(0);
    }
  });

  it('n’interprète pas une portée hostile passée en liste déroulante', () => {
    const scopes = scopesOf(HOSTILE.map((hostile) => record('ok', hostile)));
    const select = document.createElement('select');

    for (const scope of scopes) {
      const option = document.createElement('option');
      option.value = scope;
      setText(option, scope, 80);
      select.append(option);
    }

    expect(select.querySelectorAll('*')).toHaveLength(scopes.length);
    expect(select.querySelectorAll('script, img, svg, iframe, style')).toHaveLength(0);
  });
});

describe('recherche', () => {
  it.each(['(', '[', '.*', '\\', '(?:', '+', '?'])(
    'ne traite pas %o comme une expression régulière',
    (pattern) => {
      expect(() => filterHistory([entry('alice')], { search: pattern })).not.toThrow();
      expect(() =>
        filterRecords([{ timestamp: '', level: 'info', scope: 's', message: 'm' }], {
          search: pattern,
        }),
      ).not.toThrow();
    },
  );
});
