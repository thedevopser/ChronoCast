import { describe, expect, it } from 'vitest';

import { createToastQueue } from '../../../../src/web/shared/toast-queue.js';

const DURATION = 4_000;

// La file ne connaît de son élément que son identité : c'est ce qui la rend commune à l'overlay
// du compteur et à la page /goal.
interface Bulle {
  readonly id: string;
  readonly userName: string;

  readonly label?: string;
}

function toast(id: string): Bulle {
  return { id, userName: `spectateur-${id}` };
}

describe('createToastQueue', () => {
  describe('affichage', () => {
    it('n’affiche rien tant qu’aucun événement n’est arrivé', () => {
      const queue = createToastQueue<Bulle>();

      expect(queue.current(0)).toBeNull();
    });

    it('affiche une bulle dès son arrivée', () => {
      const queue = createToastQueue<Bulle>();

      queue.push(toast('a'), 1_000, DURATION);

      expect(queue.current(1_000)?.id).toBe('a');
    });

    it('la maintient pendant toute sa durée', () => {
      const queue = createToastQueue<Bulle>();
      queue.push(toast('a'), 1_000, DURATION);

      expect(queue.current(4_999)?.id).toBe('a');
    });

    it('la retire à l’échéance', () => {
      const queue = createToastQueue<Bulle>();
      queue.push(toast('a'), 1_000, DURATION);

      expect(queue.current(5_000)).toBeNull();
    });
  });

  describe('enchaînement', () => {
    it('ne remplace pas la bulle visible par une nouvelle arrivée', () => {
      const queue = createToastQueue<Bulle>();
      queue.push(toast('a'), 1_000, DURATION);

      queue.push(toast('b'), 2_000, DURATION);

      expect(queue.current(2_000)?.id).toBe('a');
    });

    it('affiche la suivante à l’expiration de la précédente', () => {
      const queue = createToastQueue<Bulle>();
      queue.push(toast('a'), 1_000, DURATION);
      queue.push(toast('b'), 2_000, DURATION);

      expect(queue.current(5_000)?.id).toBe('b');
    });

    it('accorde à la suivante sa durée pleine, comptée depuis son affichage', () => {
      const queue = createToastQueue<Bulle>();
      queue.push(toast('a'), 1_000, DURATION);
      queue.push(toast('b'), 2_000, DURATION);

      expect(queue.current(5_000)?.id).toBe('b');
      expect(queue.current(8_999)?.id).toBe('b');
      expect(queue.current(9_000)).toBeNull();
    });

    it('enchaîne toute la file, dans l’ordre d’arrivée', () => {
      const queue = createToastQueue<Bulle>();
      queue.push(toast('a'), 0, DURATION);
      queue.push(toast('b'), 0, DURATION);
      queue.push(toast('c'), 0, DURATION);

      expect(queue.current(0)?.id).toBe('a');
      expect(queue.current(4_000)?.id).toBe('b');
      expect(queue.current(8_000)?.id).toBe('c');
      expect(queue.current(12_000)).toBeNull();
    });

    it('respecte la durée propre à chaque bulle', () => {
      const queue = createToastQueue<Bulle>();
      queue.push(toast('a'), 0, 1_000);
      queue.push(toast('b'), 0, 5_000);

      expect(queue.current(1_000)?.id).toBe('b');
      expect(queue.current(5_999)?.id).toBe('b');
      expect(queue.current(6_000)).toBeNull();
    });
  });

  describe('plafond', () => {
    it('écarte les plus anciennes en attente quand la file déborde', () => {
      const queue = createToastQueue<Bulle>({ maxPending: 2 });
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
      const queue = createToastQueue<Bulle>();
      queue.push(toast('a'), 0, DURATION);
      queue.push(toast('b'), 0, DURATION);

      expect(queue.pendingCount()).toBe(1);
    });

    it('vide la file sur demande', () => {
      const queue = createToastQueue<Bulle>();
      queue.push(toast('a'), 0, DURATION);
      queue.push(toast('b'), 0, DURATION);

      queue.clear();

      expect(queue.current(0)).toBeNull();
      expect(queue.pendingCount()).toBe(0);
    });
  });
});

// La file transporte l'élément tel quel : ce qu'elle ignore de sa forme arrive intact à
// l'affichage, et c'est ce qui lui permet de servir deux pages aux charges différentes.
describe('libellé', () => {
  it('transporte le libellé jusqu’à l’affichage', () => {
    const queue = createToastQueue<Bulle>();

    queue.push({ ...toast('a'), label: 'Temps ajouté' }, 0, DURATION);

    expect(queue.current(0)?.label).toBe('Temps ajouté');
  });

  it('accepte une bulle sans libellé', () => {
    const queue = createToastQueue<Bulle>();

    queue.push(toast('a'), 0, DURATION);

    expect(queue.current(0)?.label).toBeUndefined();
  });
});
