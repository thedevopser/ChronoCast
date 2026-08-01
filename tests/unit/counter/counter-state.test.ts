import { describe, expect, it } from 'vitest';

import {
  applyAdd,
  applyPause,
  applyRemove,
  applyReset,
  applyResume,
  applySetInitial,
  applyTick,
  createInitialState,
  type CounterBounds,
  type CounterState,
} from '../../../src/core/counter/counter-state.js';

/**
 * Le compteur est le cœur métier de ChronoCast, et ces réducteurs en sont la
 * partie pure : pas d'horloge interne, pas d'entrées-sorties, pas de minuteur.
 * Toute la logique se ramène à « état + action donne nouvel état ».
 *
 * Cette séparation n'est pas de la coquetterie : elle rend vérifiables sans
 * attendre une seule seconde réelle des situations qui prendraient des heures à
 * reproduire — atteinte de zéro, plafond dépassé par une salve de gifts,
 * reprise après pause.
 */

const BOUNDS: CounterBounds = { minRemainingMs: 0, maxRemainingMs: 86_400_000 };
const NOW = 1_754_000_000_000;

/** État de départ commun : douze heures de valeur initiale, décompte en cours. */
function runningState(remainingMs = 43_200_000): CounterState {
  const started = applyResume(createInitialState({ initialMs: 43_200_000, now: NOW }), { now: NOW });
  return { ...started, remainingMs };
}

describe('createInitialState', () => {
  it('démarre à l\'arrêt, sur la valeur initiale', () => {
    const state = createInitialState({ initialMs: 43_200_000, now: NOW });

    expect(state.status).toBe('idle');
    expect(state.remainingMs).toBe(43_200_000);
    expect(state.initialMs).toBe(43_200_000);
  });

  it('part de compteurs cumulés vierges', () => {
    const state = createInitialState({ initialMs: 1_000, now: NOW });

    expect(state.totalAddedMs).toBe(0);
    expect(state.totalRemovedMs).toBe(0);
    expect(state.startedAt).toBeNull();
    expect(state.finishedAt).toBeNull();
  });
});

describe('applyTick', () => {
  it('retranche le temps écoulé quand le décompte est en cours', () => {
    const state = runningState(10_000);

    const next = applyTick(state, { elapsedMs: 3_000, bounds: BOUNDS, now: NOW });

    expect(next.remainingMs).toBe(7_000);
  });

  it('ne décompte pas à l\'arrêt', () => {
    const state = createInitialState({ initialMs: 10_000, now: NOW });

    const next = applyTick(state, { elapsedMs: 3_000, bounds: BOUNDS, now: NOW });

    expect(next.remainingMs).toBe(10_000);
    expect(next.status).toBe('idle');
  });

  it('ne décompte pas en pause', () => {
    const state = applyPause(runningState(10_000), { now: NOW });

    const next = applyTick(state, { elapsedMs: 3_000, bounds: BOUNDS, now: NOW });

    expect(next.remainingMs).toBe(10_000);
  });

  it('s\'achève en atteignant le plancher sans jamais passer dessous', () => {
    const state = runningState(2_000);

    const next = applyTick(state, { elapsedMs: 5_000, bounds: BOUNDS, now: NOW });

    expect(next.remainingMs).toBe(0);
    expect(next.status).toBe('finished');
    expect(next.finishedAt).toBe(NOW);
  });

  it('respecte un plancher configuré au-dessus de zéro', () => {
    const bounds: CounterBounds = { minRemainingMs: 600_000, maxRemainingMs: 86_400_000 };
    const state = runningState(700_000);

    const next = applyTick(state, { elapsedMs: 500_000, bounds, now: NOW });

    expect(next.remainingMs).toBe(600_000);
    expect(next.status).toBe('finished');
  });

  it('ne modifie plus rien une fois achevé', () => {
    const finished = applyTick(runningState(1_000), { elapsedMs: 5_000, bounds: BOUNDS, now: NOW });

    const next = applyTick(finished, { elapsedMs: 5_000, bounds: BOUNDS, now: NOW });

    expect(next).toBe(finished);
  });

  it('ignore un temps écoulé négatif', () => {
    // L'horloge monotone ne devrait jamais reculer, mais une valeur aberrante ne
    // doit en aucun cas créditer du temps au streamer.
    const state = runningState(10_000);

    const next = applyTick(state, { elapsedMs: -5_000, bounds: BOUNDS, now: NOW });

    expect(next.remainingMs).toBe(10_000);
  });
});

describe('applyAdd', () => {
  it('crédite le temps demandé', () => {
    const state = runningState(10_000);

    const next = applyAdd(state, { deltaMs: 180_000, bounds: BOUNDS, now: NOW });

    expect(next.remainingMs).toBe(190_000);
  });

  it('cumule le total crédité', () => {
    const state = applyAdd(runningState(10_000), { deltaMs: 180_000, bounds: BOUNDS, now: NOW });

    const next = applyAdd(state, { deltaMs: 60_000, bounds: BOUNDS, now: NOW });

    expect(next.totalAddedMs).toBe(240_000);
  });

  it('n\'excède jamais le plafond', () => {
    const bounds: CounterBounds = { minRemainingMs: 0, maxRemainingMs: 20_000 };
    const state = runningState(15_000);

    const next = applyAdd(state, { deltaMs: 30_000, bounds, now: NOW });

    expect(next.remainingMs).toBe(20_000);
  });

  it('ne comptabilise que le temps réellement crédité après plafonnement', () => {
    const bounds: CounterBounds = { minRemainingMs: 0, maxRemainingMs: 20_000 };
    const state = runningState(15_000);

    const next = applyAdd(state, { deltaMs: 30_000, bounds, now: NOW });

    expect(next.totalAddedMs).toBe(5_000);
  });

  it('relance un compteur achevé', () => {
    // Un gift sub arrivant juste après la fin doit relancer le subathon : c'est
    // exactement ce que le spectateur croit acheter.
    const finished = applyTick(runningState(1_000), { elapsedMs: 5_000, bounds: BOUNDS, now: NOW });

    const next = applyAdd(finished, { deltaMs: 180_000, bounds: BOUNDS, now: NOW });

    expect(next.status).toBe('running');
    expect(next.finishedAt).toBeNull();
    expect(next.remainingMs).toBe(180_000);
  });

  it('crédite sans démarrer un compteur encore à l\'arrêt', () => {
    const state = createInitialState({ initialMs: 10_000, now: NOW });

    const next = applyAdd(state, { deltaMs: 5_000, bounds: BOUNDS, now: NOW });

    expect(next.remainingMs).toBe(15_000);
    expect(next.status).toBe('idle');
  });

  it('ignore une valeur nulle ou négative', () => {
    const state = runningState(10_000);

    expect(applyAdd(state, { deltaMs: 0, bounds: BOUNDS, now: NOW })).toBe(state);
    expect(applyAdd(state, { deltaMs: -5_000, bounds: BOUNDS, now: NOW })).toBe(state);
  });
});

describe('applyRemove', () => {
  it('retire le temps demandé', () => {
    const state = runningState(10_000);

    const next = applyRemove(state, { deltaMs: 4_000, bounds: BOUNDS, now: NOW });

    expect(next.remainingMs).toBe(6_000);
  });

  it('cumule le total retiré', () => {
    const state = runningState(10_000);

    const next = applyRemove(state, { deltaMs: 4_000, bounds: BOUNDS, now: NOW });

    expect(next.totalRemovedMs).toBe(4_000);
  });

  it('ne descend jamais sous le plancher', () => {
    const state = runningState(3_000);

    const next = applyRemove(state, { deltaMs: 10_000, bounds: BOUNDS, now: NOW });

    expect(next.remainingMs).toBe(0);
  });

  it('achève le compteur en atteignant le plancher', () => {
    const state = runningState(3_000);

    const next = applyRemove(state, { deltaMs: 10_000, bounds: BOUNDS, now: NOW });

    expect(next.status).toBe('finished');
  });

  it('ignore une valeur nulle ou négative', () => {
    const state = runningState(10_000);

    expect(applyRemove(state, { deltaMs: 0, bounds: BOUNDS, now: NOW })).toBe(state);
    expect(applyRemove(state, { deltaMs: -1, bounds: BOUNDS, now: NOW })).toBe(state);
  });
});

describe('applyPause et applyResume', () => {
  it('met en pause un décompte en cours', () => {
    const next = applyPause(runningState(), { now: NOW });

    expect(next.status).toBe('paused');
  });

  it('reprend un décompte en pause', () => {
    const paused = applyPause(runningState(), { now: NOW });

    expect(applyResume(paused, { now: NOW }).status).toBe('running');
  });

  it('démarre un compteur encore à l\'arrêt', () => {
    const state = createInitialState({ initialMs: 10_000, now: NOW });

    const next = applyResume(state, { now: NOW });

    expect(next.status).toBe('running');
    expect(next.startedAt).toBe(NOW);
  });

  it('conserve la date de premier démarrage lors des reprises suivantes', () => {
    const started = applyResume(createInitialState({ initialMs: 10_000, now: NOW }), { now: NOW });
    const paused = applyPause(started, { now: NOW + 1_000 });

    const resumed = applyResume(paused, { now: NOW + 5_000 });

    expect(resumed.startedAt).toBe(NOW);
  });

  it('laisse inchangé un compteur déjà en pause', () => {
    const paused = applyPause(runningState(), { now: NOW });

    expect(applyPause(paused, { now: NOW })).toBe(paused);
  });

  it('refuse de reprendre un compteur achevé', () => {
    // Reprendre à zéro repartirait aussitôt en « achevé » : il faut d'abord
    // créditer du temps ou réinitialiser.
    const finished = applyTick(runningState(1_000), { elapsedMs: 5_000, bounds: BOUNDS, now: NOW });

    expect(applyResume(finished, { now: NOW })).toBe(finished);
  });
});

describe('applyReset', () => {
  it('revient à l\'arrêt sur la valeur initiale', () => {
    const state = applyAdd(runningState(10_000), { deltaMs: 5_000, bounds: BOUNDS, now: NOW });

    const next = applyReset(state, { now: NOW });

    expect(next.status).toBe('idle');
    expect(next.remainingMs).toBe(state.initialMs);
  });

  it('remet les cumuls à zéro', () => {
    const state = applyAdd(runningState(10_000), { deltaMs: 5_000, bounds: BOUNDS, now: NOW });

    const next = applyReset(state, { now: NOW });

    expect(next.totalAddedMs).toBe(0);
    expect(next.totalRemovedMs).toBe(0);
    expect(next.startedAt).toBeNull();
    expect(next.finishedAt).toBeNull();
  });
});

describe('applySetInitial', () => {
  it('répercute la nouvelle valeur sur un compteur à l\'arrêt', () => {
    const state = createInitialState({ initialMs: 10_000, now: NOW });

    const next = applySetInitial(state, { initialMs: 7_200_000, bounds: BOUNDS, now: NOW });

    expect(next.initialMs).toBe(7_200_000);
    expect(next.remainingMs).toBe(7_200_000);
  });

  it('ne touche pas au temps restant d\'un décompte en cours', () => {
    // Changer la valeur de départ en plein subathon ne doit pas effacer le temps
    // déjà gagné par les spectateurs.
    const state = runningState(10_000);

    const next = applySetInitial(state, { initialMs: 7_200_000, bounds: BOUNDS, now: NOW });

    expect(next.initialMs).toBe(7_200_000);
    expect(next.remainingMs).toBe(10_000);
  });

  it('ignore une valeur initiale nulle ou négative', () => {
    const state = createInitialState({ initialMs: 10_000, now: NOW });

    expect(applySetInitial(state, { initialMs: 0, bounds: BOUNDS, now: NOW })).toBe(state);
    expect(applySetInitial(state, { initialMs: -1, bounds: BOUNDS, now: NOW })).toBe(state);
  });
});

describe('immuabilité', () => {
  it('ne modifie jamais l\'état fourni', () => {
    const state = runningState(10_000);
    const copie = { ...state };

    applyTick(state, { elapsedMs: 1_000, bounds: BOUNDS, now: NOW });
    applyAdd(state, { deltaMs: 1_000, bounds: BOUNDS, now: NOW });
    applyRemove(state, { deltaMs: 1_000, bounds: BOUNDS, now: NOW });
    applyPause(state, { now: NOW });
    applyReset(state, { now: NOW });

    expect(state).toEqual(copie);
  });

  it('horodate chaque transition effective', () => {
    const state = runningState(10_000);

    const next = applyAdd(state, { deltaMs: 1_000, bounds: BOUNDS, now: NOW + 42 });

    expect(next.updatedAt).toBe(NOW + 42);
  });
});
