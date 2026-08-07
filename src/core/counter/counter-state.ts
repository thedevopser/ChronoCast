export type CounterStatus = 'idle' | 'running' | 'paused' | 'finished';

export const COUNTER_STATE_VERSION = 1;

export interface CounterState {
  readonly remainingMs: number;

  readonly status: CounterStatus;

  readonly initialMs: number;

  readonly totalAddedMs: number;

  readonly totalRemovedMs: number;

  readonly startedAt: number | null;

  readonly finishedAt: number | null;

  readonly updatedAt: number;

  readonly schemaVersion: number;
}

export interface CounterBounds {
  readonly minRemainingMs: number;

  readonly maxRemainingMs: number;
}

export interface CreateInitialStateParams {
  readonly initialMs: number;
  readonly now: number;
}

export interface TickParams {
  readonly elapsedMs: number;
  readonly bounds: CounterBounds;
  readonly now: number;
}

export interface DeltaParams {
  readonly deltaMs: number;
  readonly bounds: CounterBounds;
  readonly now: number;
}

export interface InstantParams {
  readonly now: number;
}

export interface SetInitialParams {
  readonly initialMs: number;
  readonly bounds: CounterBounds;
  readonly now: number;
}

function clamp(value: number, bounds: CounterBounds): number {
  if (value < bounds.minRemainingMs) {
    return bounds.minRemainingMs;
  }
  if (value > bounds.maxRemainingMs) {
    return bounds.maxRemainingMs;
  }
  return value;
}

export function createInitialState(params: CreateInitialStateParams): CounterState {
  return {
    remainingMs: params.initialMs,
    status: 'idle',
    initialMs: params.initialMs,
    totalAddedMs: 0,
    totalRemovedMs: 0,
    startedAt: null,
    finishedAt: null,
    updatedAt: params.now,
    schemaVersion: COUNTER_STATE_VERSION,
  };
}

export function applyTick(state: CounterState, params: TickParams): CounterState {
  if (state.status !== 'running' || params.elapsedMs <= 0) {
    return state;
  }

  const remainingMs = clamp(state.remainingMs - params.elapsedMs, params.bounds);
  const reachedFloor = remainingMs <= params.bounds.minRemainingMs;

  return {
    ...state,
    remainingMs,
    status: reachedFloor ? 'finished' : state.status,
    finishedAt: reachedFloor ? params.now : state.finishedAt,
    updatedAt: params.now,
  };
}

export function applyAdd(state: CounterState, params: DeltaParams): CounterState {
  if (params.deltaMs <= 0) {
    return state;
  }

  const remainingMs = clamp(state.remainingMs + params.deltaMs, params.bounds);
  const actuallyAdded = remainingMs - state.remainingMs;

  if (actuallyAdded === 0) {
    return state;
  }

  const revives = state.status === 'finished' && remainingMs > params.bounds.minRemainingMs;

  return {
    ...state,
    remainingMs,
    totalAddedMs: state.totalAddedMs + actuallyAdded,
    status: revives ? 'running' : state.status,
    finishedAt: revives ? null : state.finishedAt,
    updatedAt: params.now,
  };
}

export function applyRemove(state: CounterState, params: DeltaParams): CounterState {
  if (params.deltaMs <= 0) {
    return state;
  }

  const remainingMs = clamp(state.remainingMs - params.deltaMs, params.bounds);
  const actuallyRemoved = state.remainingMs - remainingMs;

  if (actuallyRemoved === 0) {
    return state;
  }

  const reachedFloor = remainingMs <= params.bounds.minRemainingMs;

  return {
    ...state,
    remainingMs,
    totalRemovedMs: state.totalRemovedMs + actuallyRemoved,
    status: reachedFloor ? 'finished' : state.status,
    finishedAt: reachedFloor ? params.now : state.finishedAt,
    updatedAt: params.now,
  };
}

export function applyPause(state: CounterState, params: InstantParams): CounterState {
  if (state.status !== 'running') {
    return state;
  }

  return { ...state, status: 'paused', updatedAt: params.now };
}

export function applyResume(state: CounterState, params: InstantParams): CounterState {
  if (state.status !== 'idle' && state.status !== 'paused') {
    return state;
  }

  return {
    ...state,
    status: 'running',
    startedAt: state.startedAt ?? params.now,
    updatedAt: params.now,
  };
}

export function applyReset(state: CounterState, params: InstantParams): CounterState {
  return {
    ...createInitialState({ initialMs: state.initialMs, now: params.now }),
    schemaVersion: state.schemaVersion,
  };
}

export function applySetInitial(state: CounterState, params: SetInitialParams): CounterState {
  if (params.initialMs <= 0) {
    return state;
  }

  if (state.status !== 'idle') {
    return { ...state, initialMs: params.initialMs, updatedAt: params.now };
  }

  return {
    ...state,
    initialMs: params.initialMs,
    remainingMs: clamp(params.initialMs, params.bounds),
    updatedAt: params.now,
  };
}
