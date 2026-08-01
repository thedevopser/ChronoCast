import { describe, expect, it, vi } from 'vitest';

import { createEventBus, type Unsubscribe } from '../../../src/core/app/event-bus.js';

/**
 * Le bus est la colonne vertébrale de l'application : le client EventSub, le
 * service compteur, le serveur WebSocket et le panneau d'administration ne se
 * connaissent pas et ne communiquent que par lui.
 *
 * Sa robustesse est donc critique : un abonné défaillant ne doit jamais empêcher
 * les autres de recevoir l'événement. Concrètement, si la diffusion vers
 * l'overlay échoue, la persistance du compteur doit malgré tout avoir lieu.
 */

interface TestEvents extends Record<string, unknown> {
  readonly 'counter:changed': { readonly restantMs: number };
  readonly 'twitch:status': { readonly connected: boolean };
}

describe('createEventBus', () => {
  describe('publication et abonnement', () => {
    it('transmet la charge utile à l\'abonné', () => {
      const bus = createEventBus<TestEvents>();
      const handler = vi.fn();
      bus.on('counter:changed', handler);

      bus.emit('counter:changed', { restantMs: 1000 });

      expect(handler).toHaveBeenCalledWith({ restantMs: 1000 });
    });

    it('notifie tous les abonnés dans leur ordre d\'inscription', () => {
      const bus = createEventBus<TestEvents>();
      const ordre: string[] = [];
      bus.on('counter:changed', () => ordre.push('premier'));
      bus.on('counter:changed', () => ordre.push('second'));

      bus.emit('counter:changed', { restantMs: 1 });

      expect(ordre).toEqual(['premier', 'second']);
    });

    it('n\'appelle que les abonnés du type émis', () => {
      const bus = createEventBus<TestEvents>();
      const autre = vi.fn();
      bus.on('twitch:status', autre);

      bus.emit('counter:changed', { restantMs: 1 });

      expect(autre).not.toHaveBeenCalled();
    });

    it('accepte une émission sans aucun abonné', () => {
      const bus = createEventBus<TestEvents>();

      expect(() => {
        bus.emit('counter:changed', { restantMs: 1 });
      }).not.toThrow();
    });

    it('inscrit deux fois un même abonné et l\'appelle deux fois', () => {
      const bus = createEventBus<TestEvents>();
      const handler = vi.fn();
      bus.on('counter:changed', handler);
      bus.on('counter:changed', handler);

      bus.emit('counter:changed', { restantMs: 1 });

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('désabonnement', () => {
    it('cesse la notification via la fonction rendue à l\'inscription', () => {
      const bus = createEventBus<TestEvents>();
      const handler = vi.fn();
      const unsubscribe = bus.on('counter:changed', handler);

      unsubscribe();
      bus.emit('counter:changed', { restantMs: 1 });

      expect(handler).not.toHaveBeenCalled();
    });

    it('tolère un désabonnement répété', () => {
      const bus = createEventBus<TestEvents>();
      const unsubscribe = bus.on('counter:changed', vi.fn());

      unsubscribe();

      expect(() => {
        unsubscribe();
      }).not.toThrow();
    });

    it('ne retire qu\'une inscription lorsqu\'un abonné est inscrit deux fois', () => {
      const bus = createEventBus<TestEvents>();
      const handler = vi.fn();
      const premier = bus.on('counter:changed', handler);
      bus.on('counter:changed', handler);

      premier();
      bus.emit('counter:changed', { restantMs: 1 });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('retire tous les abonnés sur demande', () => {
      const bus = createEventBus<TestEvents>();
      const handler = vi.fn();
      bus.on('counter:changed', handler);
      bus.on('twitch:status', handler);

      bus.clear();
      bus.emit('counter:changed', { restantMs: 1 });
      bus.emit('twitch:status', { connected: true });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('abonnement unique', () => {
    it('ne notifie qu\'une seule fois', () => {
      const bus = createEventBus<TestEvents>();
      const handler = vi.fn();
      bus.once('counter:changed', handler);

      bus.emit('counter:changed', { restantMs: 1 });
      bus.emit('counter:changed', { restantMs: 2 });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ restantMs: 1 });
    });

    it('peut être annulé avant sa première notification', () => {
      const bus = createEventBus<TestEvents>();
      const handler = vi.fn();
      const unsubscribe = bus.once('counter:changed', handler);

      unsubscribe();
      bus.emit('counter:changed', { restantMs: 1 });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('robustesse', () => {
    it('poursuit la diffusion lorsqu\'un abonné lève une exception', () => {
      const bus = createEventBus<TestEvents>({ onHandlerError: () => undefined });
      const suivant = vi.fn();
      bus.on('counter:changed', () => {
        throw new Error('abonné défaillant');
      });
      bus.on('counter:changed', suivant);

      bus.emit('counter:changed', { restantMs: 1 });

      expect(suivant).toHaveBeenCalledTimes(1);
    });

    it('ne propage pas l\'exception à l\'émetteur', () => {
      const bus = createEventBus<TestEvents>({ onHandlerError: () => undefined });
      bus.on('counter:changed', () => {
        throw new Error('abonné défaillant');
      });

      expect(() => {
        bus.emit('counter:changed', { restantMs: 1 });
      }).not.toThrow();
    });

    it('signale la défaillance avec le type d\'événement concerné', () => {
      const onHandlerError = vi.fn();
      const bus = createEventBus<TestEvents>({ onHandlerError });
      const failure = new Error('abonné défaillant');
      bus.on('counter:changed', () => {
        throw failure;
      });

      bus.emit('counter:changed', { restantMs: 1 });

      expect(onHandlerError).toHaveBeenCalledWith(failure, 'counter:changed');
    });

    it('ignore un abonné inscrit pendant la diffusion en cours', () => {
      const bus = createEventBus<TestEvents>();
      const tardif = vi.fn();
      bus.on('counter:changed', () => {
        bus.on('counter:changed', tardif);
      });

      bus.emit('counter:changed', { restantMs: 1 });

      expect(tardif).not.toHaveBeenCalled();
    });

    it('n\'appelle pas un abonné désinscrit pendant la diffusion en cours', () => {
      const bus = createEventBus<TestEvents>();
      const jamaisAppele = vi.fn();
      const retraits: Unsubscribe[] = [];

      // Le premier abonné retire le second avant que celui-ci ne soit atteint :
      // un désabonnement doit prendre effet immédiatement, y compris en pleine
      // diffusion. C'est le cas réel de l'arrêt de l'application, où un composant
      // se détache pendant qu'un événement circule encore.
      bus.on('counter:changed', () => {
        for (const retirer of retraits) {
          retirer();
        }
      });
      retraits.push(bus.on('counter:changed', jamaisAppele));

      bus.emit('counter:changed', { restantMs: 1 });

      expect(jamaisAppele).not.toHaveBeenCalled();
    });
  });
});
