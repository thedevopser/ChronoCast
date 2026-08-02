/**
 * Non-interprétation du contenu hostile dans l'historique et les journaux.
 *
 * Ces deux vues affichent ce qu'aucune autre n'affiche : du texte venu de
 * tiers non fiables, conservé sur le disque, puis relu plus tard. Un pseudo
 * choisi par un viewer traverse l'historique ; un message de journal peut
 * contenir un pseudo, une URL, une charge utile EventSub entière.
 *
 * La section 9 du document de reprise exige un test d'injection par pseudo.
 * `xss-overlay.test.ts` le fait pour l'overlay ; celui-ci le fait pour le
 * panneau, où le contenu ne fait pas que passer — il est stocké, filtré,
 * paginé, et réaffiché longtemps après.
 *
 * **La preuve porte sur le parseur, pas sur l'appel.** Vérifier qu'on a appelé
 * `textContent` ne prouve rien : c'est happy-dom qui doit constater qu'aucun
 * élément n'est né du contenu. D'où ce fichier dans `tests/security/`, seul
 * emplacement avec `tests/unit/web/**` où le DOM est réellement présent.
 *
 * `innerHTML` est banni jusque dans les tests : les assertions passent donc par
 * `querySelectorAll`, `childNodes` et `textContent`.
 */

import { describe, expect, it } from 'vitest';

import { filterHistory, formatDetail, type HistoryEntry } from '../../src/web/admin/history-view.js';
import { appendRecords, createLogBuffer, filterRecords, scopesOf, type LogRecord } from '../../src/web/admin/log-view.js';
import { setText } from '../../src/web/shared/safe-dom.js';

/**
 * Charges utiles hostiles, alignées sur celles de `xss-overlay.test.ts`.
 *
 * Aucune n'est exotique : ce sont des pseudos que Twitch accepterait dans un
 * champ d'affichage, ou des textes qu'un viewer peut envoyer dans un cheer.
 */
const HOSTILE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '"><script>alert(1)</script>',
  // Le schéma `javascript:` n'apparaît qu'imbriqué dans un attribut : ESLint
  // interdit le littéral nu, y compris ici, et les deux formes ci-dessous
  // couvrent déjà ce qu'on veut prouver.
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

/** Écrit une valeur comme la vue le fait, puis rend le nœud pour inspection. */
function paint(value: string, maxLength = 500): HTMLElement {
  const host = document.createElement('span');
  setText(host, value, maxLength);
  return host;
}

describe('pseudos hostiles dans l’historique', () => {
  it.each(HOSTILE)('n’engendre aucun élément pour %o', (hostile) => {
    const host = paint(entry(hostile).userName);

    expect(host.querySelectorAll('*')).toHaveLength(0);
    // Un seul nœud, et c'est du texte : rien n'a été parsé.
    expect(host.childNodes).toHaveLength(1);
    expect(host.childNodes[0]?.nodeType).toBe(host.TEXT_NODE);
  });

  it.each(HOSTILE)('n’engendre aucun élément depuis le motif %o', (hostile) => {
    // Le motif est écrit par le serveur mais porte le pseudo : il hérite donc
    // du même contenu non fiable.
    const host = paint(entry('alice', hostile).reason);

    expect(host.querySelectorAll('*')).toHaveLength(0);
  });

  it('ne laisse passer aucun script à travers le filtrage', () => {
    // Le filtrage précède l'affichage : il ne doit ni transformer, ni
    // interpréter, ni faire disparaître le contenu qu'on s'apprête à assainir.
    const entries = HOSTILE.map((hostile) => entry(hostile));
    const filtered = filterHistory(entries, {});

    for (const item of filtered) {
      expect(paint(item.userName).querySelectorAll('*')).toHaveLength(0);
    }
  });

  it('conserve le contenu hostile comme texte lisible', () => {
    // La preuve inverse : le pseudo ne doit pas non plus disparaître, sans
    // quoi le test passerait pour de mauvaises raisons.
    const host = paint('<script>alert(1)</script>');

    expect(host.textContent).toContain('script');
  });

  it('n’interprète pas un détail hostile venu du disque', () => {
    // Le détail est relu d'un fichier JSONL qu'une version antérieure a écrit :
    // sa forme n'est pas garantie par le code qui l'affiche.
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
    // La portée est composée par le code, mais elle finit dans une liste
    // déroulante engendrée : rien ne doit y échapper non plus.
    const host = paint(record('ok', hostile).scope, 80);

    expect(host.querySelectorAll('*')).toHaveLength(0);
  });

  it('n’interprète pas un contexte hostile sérialisé', () => {
    // Le contexte est du JSON indenté écrit dans un seul nœud texte. Le
    // reconstruire en éléments rendrait sa profondeur — donc son contenu —
    // capable de créer des nœuds.
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

    // Une `<option>` par portée, et rien d'autre : aucun nœud n'est né du
    // contenu lui-même.
    expect(select.querySelectorAll('*')).toHaveLength(scopes.length);
    expect(select.querySelectorAll('script, img, svg, iframe, style')).toHaveLength(0);
  });
});

describe('recherche', () => {
  it.each(['(', '[', '.*', '\\', '(?:', '+', '?'])(
    'ne traite pas %o comme une expression régulière',
    (pattern) => {
      // Un champ de recherche qui lève sur une parenthèse rendrait la vue
      // inutilisable dès qu'on cherche un pseudo qui en contient une.
      expect(() => filterHistory([entry('alice')], { search: pattern })).not.toThrow();
      expect(() =>
        filterRecords([{ timestamp: '', level: 'info', scope: 's', message: 'm' }], {
          search: pattern,
        }),
      ).not.toThrow();
    },
  );
});
