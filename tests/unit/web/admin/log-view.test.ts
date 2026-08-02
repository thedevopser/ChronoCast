/**
 * Tampon des journaux affichés.
 *
 * Les journaux diffèrent de l'historique sur un point qui change tout : ils
 * **arrivent en continu** par le canal `log` du WebSocket, pendant qu'on les
 * lit. Trois conséquences, et ce module existe pour les trois :
 *
 * - le tampon est **plafonné**, sinon six heures de direct en niveau debug
 *   finissent par saturer l'onglet ;
 * - le filtre par niveau est un **seuil minimal**, pas une égalité : chercher
 *   les avertissements sans voir les erreurs n'aurait aucun sens, et c'est
 *   déjà la sémantique du serveur ;
 * - la **pause** doit figer ce qui est affiché sans perdre ce qui arrive,
 *   faute de quoi lire une pile d'appel devient impossible.
 */

import { describe, expect, it } from 'vitest';

import {
  appendRecords,
  createLogBuffer,
  filterRecords,
  MAX_LOG_RECORDS,
  scopesOf,
  type LogRecord,
} from '../../../../src/web/admin/log-view.js';

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    timestamp: '2026-08-02T06:00:00.000Z',
    level: 'info',
    scope: 'app',
    message: 'démarré',
    ...overrides,
  };
}

describe('createLogBuffer', () => {
  it('part vide', () => {
    expect(createLogBuffer().records).toEqual([]);
  });
});

describe('appendRecords', () => {
  it('ajoute à la suite, le plus récent en dernier', () => {
    const buffer = appendRecords(createLogBuffer(), [record({ message: 'un' }), record({ message: 'deux' })]);

    expect(buffer.records.map((entry) => entry.message)).toEqual(['un', 'deux']);
  });

  it('conserve les enregistrements déjà présents', () => {
    let buffer = appendRecords(createLogBuffer(), [record({ message: 'un' })]);
    buffer = appendRecords(buffer, [record({ message: 'deux' })]);

    expect(buffer.records).toHaveLength(2);
  });

  it('plafonne le tampon en écartant les plus anciens', () => {
    // Six heures de direct en niveau debug satureraient autrement l'onglet.
    const many = Array.from({ length: MAX_LOG_RECORDS + 50 }, (_, index) =>
      record({ message: `m${String(index)}` }),
    );
    const buffer = appendRecords(createLogBuffer(), many);

    expect(buffer.records).toHaveLength(MAX_LOG_RECORDS);
    // Ce sont les plus récents qui restent : un journal qu'on consulte en
    // direct sert à voir ce qui vient de se passer.
    expect(buffer.records[buffer.records.length - 1]?.message).toBe(
      `m${String(MAX_LOG_RECORDS + 49)}`,
    );
  });

  it('rend le même tampon quand il n’y a rien à ajouter', () => {
    const buffer = createLogBuffer();

    expect(appendRecords(buffer, [])).toBe(buffer);
  });

  it('remplace intégralement sur demande', () => {
    // Le rechargement par `GET /api/logs` doit repartir de zéro, sans quoi les
    // enregistrements déjà reçus par le WebSocket apparaîtraient deux fois.
    let buffer = appendRecords(createLogBuffer(), [record({ message: 'ancien' })]);
    buffer = appendRecords(createLogBuffer(), [record({ message: 'neuf' })]);

    expect(buffer.records.map((entry) => entry.message)).toEqual(['neuf']);
  });

  it('ne modifie pas le tampon reçu', () => {
    const buffer = appendRecords(createLogBuffer(), [record()]);
    const snapshot = JSON.stringify(buffer);

    appendRecords(buffer, [record({ message: 'autre' })]);

    expect(JSON.stringify(buffer)).toBe(snapshot);
  });
});

describe('filterRecords', () => {
  const records: readonly LogRecord[] = [
    record({ level: 'debug', scope: 'twitch', message: 'trace' }),
    record({ level: 'info', scope: 'app', message: 'démarré' }),
    record({ level: 'warning', scope: 'twitch:eventsub', message: 'reconnexion' }),
    record({ level: 'error', scope: 'counter', message: 'écriture en échec' }),
  ];

  it('rend tout sans filtre', () => {
    expect(filterRecords(records, {})).toHaveLength(4);
  });

  it('filtre par niveau minimal et non par égalité', () => {
    // Chercher les avertissements sans voir les erreurs n'aurait aucun sens :
    // c'est déjà la sémantique retenue côté serveur.
    expect(filterRecords(records, { level: 'warning' }).map((entry) => entry.level)).toEqual([
      'warning',
      'error',
    ]);
  });

  it('laisse tout passer au niveau le plus bas', () => {
    expect(filterRecords(records, { level: 'debug' })).toHaveLength(4);
  });

  it('ignore un niveau vide', () => {
    expect(filterRecords(records, { level: '' })).toHaveLength(4);
  });

  it('ignore un niveau inconnu plutôt que de tout masquer', () => {
    expect(filterRecords(records, { level: 'critique' })).toHaveLength(4);
  });

  it('filtre par portée, préfixe compris', () => {
    // Les portées sont imbriquées : demander « twitch » doit ramener
    // « twitch:eventsub », sinon le filtre oblige à connaître l'arborescence.
    expect(filterRecords(records, { scope: 'twitch' }).map((entry) => entry.scope)).toEqual([
      'twitch',
      'twitch:eventsub',
    ]);
  });

  it('recherche dans le message, sans tenir compte de la casse', () => {
    expect(filterRecords(records, { search: 'ÉCHEC' })).toHaveLength(1);
  });

  it('ne traite pas la recherche comme une expression régulière', () => {
    expect(() => filterRecords(records, { search: '([' })).not.toThrow();
    expect(filterRecords(records, { search: '.*' })).toHaveLength(0);
  });

  it('combine les filtres', () => {
    expect(filterRecords(records, { level: 'warning', scope: 'twitch' })).toHaveLength(1);
  });
});

describe('scopesOf', () => {
  it('énumère les portées présentes, triées et sans doublon', () => {
    const scopes = scopesOf([
      record({ scope: 'twitch' }),
      record({ scope: 'app' }),
      record({ scope: 'twitch' }),
    ]);

    expect(scopes).toEqual(['app', 'twitch']);
  });

  it('rend une liste vide pour un tampon vide', () => {
    expect(scopesOf([])).toEqual([]);
  });
});
