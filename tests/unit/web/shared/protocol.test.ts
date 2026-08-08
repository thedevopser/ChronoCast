import { describe, expect, it } from 'vitest';

import type { CounterChangeOrigin, TwitchConnectionStatus } from '../../../../src/core/app/app-events.js';
import type { OverlayConfig } from '../../../../src/core/config/schema.js';
import type { CounterState } from '../../../../src/core/counter/counter-state.js';
import type { DomainEvent } from '../../../../src/core/events/domain-event.js';
import type { LogRecord } from '../../../../src/core/logging/logger.js';
import {
  CHANNELS as CORE_CHANNELS,
  DEFAULT_CHANNELS as CORE_DEFAULT_CHANNELS,
  PROTOCOL_VERSION as CORE_PROTOCOL_VERSION,
  type Channel as CoreChannel,
  type ClientMessage as CoreClientMessage,
  type ServerMessage as CoreServerMessage,
} from '../../../../src/core/server/protocol.js';
import {
  CHANNELS,
  DEFAULT_CHANNELS,
  PROTOCOL_VERSION,
  parseServerMessage,
  type Channel,
  type ClientMessage,
  type CounterChangeOrigin as WebCounterChangeOrigin,
  type CounterState as WebCounterState,
  type DomainEvent as WebDomainEvent,
  type LogRecord as WebLogRecord,
  type OverlayConfig as WebOverlayConfig,
  type ServerMessage,
  type TwitchConnectionStatus as WebTwitchConnectionStatus,
} from '../../../../src/web/shared/protocol.js';

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type Aligned<T extends true> = T;

export type CounterStateAligned = Aligned<MutuallyAssignable<CounterState, WebCounterState>>;
export type DomainEventAligned = Aligned<MutuallyAssignable<DomainEvent, WebDomainEvent>>;
export type LogRecordAligned = Aligned<MutuallyAssignable<LogRecord, WebLogRecord>>;
export type OverlayConfigAligned = Aligned<MutuallyAssignable<OverlayConfig, WebOverlayConfig>>;
export type ServerMessageAligned = Aligned<MutuallyAssignable<CoreServerMessage, ServerMessage>>;
export type ClientMessageAligned = Aligned<MutuallyAssignable<CoreClientMessage, ClientMessage>>;
export type ChannelAligned = Aligned<MutuallyAssignable<CoreChannel, Channel>>;
export type OriginAligned = Aligned<MutuallyAssignable<CounterChangeOrigin, WebCounterChangeOrigin>>;
export type StatusAligned = Aligned<
  MutuallyAssignable<TwitchConnectionStatus, WebTwitchConnectionStatus>
>;

describe('alignement des constantes avec le noyau', () => {
  it('déclare la même version de protocole que le noyau', () => {
    expect(PROTOCOL_VERSION).toBe(CORE_PROTOCOL_VERSION);
  });

  it('déclare les mêmes canaux, dans le même ordre', () => {
    expect(CHANNELS).toStrictEqual(CORE_CHANNELS);
  });

  it("déclare le même abonnement par défaut que le hub", () => {
    expect(DEFAULT_CHANNELS).toStrictEqual(CORE_DEFAULT_CHANNELS);
  });
});

describe('parseServerMessage', () => {
  it('accepte un message bien formé et le rend typé', () => {
    const message = parseServerMessage('{"type":"pong"}');

    expect(message).toStrictEqual({ type: 'pong' });
  });

  it('conserve les champs du message', () => {
    const message = parseServerMessage(
      '{"type":"twitch:status","status":"ready","detail":"souscriptions actives"}',
    );

    expect(message).toStrictEqual({
      type: 'twitch:status',
      status: 'ready',
      detail: 'souscriptions actives',
    });
  });

  describe('refus', () => {
    it('rejette du JSON invalide sans lever', () => {
      expect(parseServerMessage('{ceci n’est pas du JSON')).toBeNull();
    });

    it('rejette une charge utile qui n’est pas une chaîne', () => {
      expect(parseServerMessage(new ArrayBuffer(8))).toBeNull();
      expect(parseServerMessage(null)).toBeNull();
    });

    it('rejette un JSON valide qui n’est pas un objet', () => {
      expect(parseServerMessage('42')).toBeNull();
      expect(parseServerMessage('"pong"')).toBeNull();
      expect(parseServerMessage('null')).toBeNull();
      expect(parseServerMessage('[{"type":"pong"}]')).toBeNull();
    });

    it('rejette un type inconnu', () => {
      expect(parseServerMessage('{"type":"shutdown"}')).toBeNull();
    });

    it('rejette un message sans discriminant', () => {
      expect(parseServerMessage('{"status":"ready"}')).toBeNull();
      expect(parseServerMessage('{"type":7}')).toBeNull();
    });
  });

  describe('innocuité', () => {
    it("ne pollue pas le prototype d'Object", () => {
      parseServerMessage('{"type":"pong","__proto__":{"pollué":true}}');

      const probe: Record<string, unknown> = {};
      expect(probe['pollué']).toBeUndefined();
      expect(Object.prototype).not.toHaveProperty('pollué');
    });
  });
});
