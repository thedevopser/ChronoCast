/**
 * File d'attente des bulles d'événement de l'overlay.
 *
 * Le risque couvert est celui de la salve. Un don groupé de cent abonnements
 * produit cent événements en quelques secondes ; sans file, cent bulles se
 * superposeraient à l'écran, illisibles, et l'overlay resterait encombré
 * pendant plusieurs minutes après la fin de la salve.
 *
 * D'où deux règles : **une bulle à la fois**, et une file **plafonnée**. Quand
 * le plafond est atteint, ce sont les plus anciennes en attente qui sont
 * écartées, jamais les plus récentes : le spectateur qui vient d'offrir doit se
 * voir remercié, alors qu'une bulle vieille de trois minutes n'intéresse plus
 * personne.
 *
 * Tout est piloté par un instant passé en argument. Aucun minuteur, aucune
 * attente : une durée d'affichage de quatre secondes se vérifie en quelques
 * microsecondes.
 */

import { describe, expect, it } from 'vitest';

import { createToastQueue, type Toast } from '../../../../src/web/overlay/toast-queue.js';

const DURATION = 4_000;

function toast(id: string): Toast {
  return { id, userName: `spectateur-${id}`, rewardSeconds: 300, type: 'sub' };
}

describe('createToastQueue', () => {
  describe('affichage', () => {
    it('n’affiche rien tant qu’aucun événement n’est arrivé', () => {
      const queue = createToastQueue();

      expect(queue.current(0)).toBeNull();
    });

    it('affiche une bulle dès son arrivée', () => {
      const queue = createToastQueue();

      queue.push(toast('a'), 1_000, DURATION);

      expect(queue.current(1_000)?.id).toBe('a');
    });

    it('la maintient pendant toute sa durée', () => {
      const queue = createToastQueue();
      queue.push(toast('a'), 1_000, DURATION);

      expect(queue.current(4_999)?.id).toBe('a');
    });

    it('la retire à l’échéance', () => {
      const queue = createToastQueue();
      queue.push(toast('a'), 1_000, DURATION);

      expect(queue.current(5_000)).toBeNull();
    });
  });

  describe('enchaînement', () => {
    it('ne remplace pas la bulle visible par une nouvelle arrivée', () => {
      // Interrompre une bulle en cours ferait clignoter l'overlay pendant une
      // salve, et personne n'aurait le temps de lire quoi que ce soit.
      const queue = createToastQueue();
      queue.push(toast('a'), 1_000, DURATION);

      queue.push(toast('b'), 2_000, DURATION);

      expect(queue.current(2_000)?.id).toBe('a');
    });

    it('affiche la suivante à l’expiration de la précédente', () => {
      const queue = createToastQueue();
      queue.push(toast('a'), 1_000, DURATION);
      queue.push(toast('b'), 2_000, DURATION);

      expect(queue.current(5_000)?.id).toBe('b');
    });

    it('accorde à la suivante sa durée pleine, comptée depuis son affichage', () => {
      // Sans cela, une bulle mise en file trois secondes plus tôt ne resterait
      // qu'une seconde à l'écran.
      const queue = createToastQueue();
      queue.push(toast('a'), 1_000, DURATION);
      queue.push(toast('b'), 2_000, DURATION);

      expect(queue.current(5_000)?.id).toBe('b');
      expect(queue.current(8_999)?.id).toBe('b');
      expect(queue.current(9_000)).toBeNull();
    });

    it('enchaîne toute la file, dans l’ordre d’arrivée', () => {
      const queue = createToastQueue();
      queue.push(toast('a'), 0, DURATION);
      queue.push(toast('b'), 0, DURATION);
      queue.push(toast('c'), 0, DURATION);

      expect(queue.current(0)?.id).toBe('a');
      expect(queue.current(4_000)?.id).toBe('b');
      expect(queue.current(8_000)?.id).toBe('c');
      expect(queue.current(12_000)).toBeNull();
    });

    it('respecte la durée propre à chaque bulle', () => {
      // La durée est capturée à l'arrivée : un changement de configuration en
      // cours de route ne rallonge pas rétroactivement ce qui est déjà en file.
      const queue = createToastQueue();
      queue.push(toast('a'), 0, 1_000);
      queue.push(toast('b'), 0, 5_000);

      expect(queue.current(1_000)?.id).toBe('b');
      expect(queue.current(5_999)?.id).toBe('b');
      expect(queue.current(6_000)).toBeNull();
    });
  });

  describe('plafond', () => {
    it('écarte les plus anciennes en attente quand la file déborde', () => {
      // Un don groupé de cent abonnements ne doit pas occuper l'overlay pendant
      // sept minutes. On garde les plus récentes : ce sont elles qu'un
      // spectateur attend de voir.
      const queue = createToastQueue({ maxPending: 2 });
      queue.push(toast('visible'), 0, DURATION);
      queue.push(toast('a'), 0, DURATION);
      queue.push(toast('b'), 0, DURATION);
      queue.push(toast('c'), 0, DURATION);

      expect(queue.current(0)?.id).toBe('visible');
      expect(queue.current(4_000)?.id).toBe('b');
      expect(queue.current(8_000)?.id).toBe('c');
      expect(queue.current(12_000)).toBeNull();
    });

    it('expose le nombre de bulles en attente', () => {
      const queue = createToastQueue();
      queue.push(toast('a'), 0, DURATION);
      queue.push(toast('b'), 0, DURATION);

      expect(queue.pendingCount()).toBe(1);
    });

    it('vide la file sur demande', () => {
      // Une réinitialisation du compteur doit pouvoir nettoyer l'écran.
      const queue = createToastQueue();
      queue.push(toast('a'), 0, DURATION);
      queue.push(toast('b'), 0, DURATION);

      queue.clear();

      expect(queue.current(0)).toBeNull();
      expect(queue.pendingCount()).toBe(0);
    });
  });
});

describe('libellé', () => {
  it('transporte le libellé jusqu’à l’affichage', () => {
    // La file ne l'interprète pas : elle le porte. Le libellé vient de la
    // configuration locale, pas du réseau, et l'overlay l'écrira par `setText`
    // comme tout le reste.
    const queue = createToastQueue();

    queue.push({ ...toast('a'), type: 'command', label: 'Temps ajouté' }, 0, DURATION);

    expect(queue.current(0)?.label).toBe('Temps ajouté');
  });

  it('accepte une bulle sans libellé', () => {
    // C'est le cas de tous les événements de plateforme : il n'y a rien à
    // annoncer au-dessus du pseudo.
    const queue = createToastQueue();

    queue.push(toast('a'), 0, DURATION);

    expect(queue.current(0)?.label).toBeUndefined();
  });
});
