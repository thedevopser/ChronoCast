export interface HistoryEntry {
  readonly id: string;
  readonly type: 'sub' | 'resub' | 'gift' | 'bits' | 'raid' | 'follow' | 'command';
  readonly occurredAt: number;
  readonly recordedAt: number;
  readonly userId: string;
  readonly userName: string;
  readonly source: 'eventsub' | 'chat-notification' | 'manual' | 'chat-command';
  readonly detail: string | number | null;
  readonly rewardSeconds: number;
  readonly applied: boolean;
  readonly reason: string;
  readonly remainingMsAfter: number;
}

export interface HistoryFilter {
  readonly type?: string;
  readonly applied?: boolean;
  readonly search?: string;
}

export function filterHistory(
  entries: readonly HistoryEntry[],
  filter: HistoryFilter,
): readonly HistoryEntry[] {
  const search = filter.search?.trim().toLowerCase() ?? '';

  return entries.filter((entry) => {
    if (filter.type !== undefined && filter.type !== '' && entry.type !== filter.type) {
      return false;
    }

    if (filter.applied !== undefined && entry.applied !== filter.applied) {
      return false;
    }

    return search === '' || entry.userName.toLowerCase().includes(search);
  });
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageCount: number;
}

export function paginate<T>(items: readonly T[], page: number, size: number): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(0, Math.trunc(page)), pageCount - 1);
  const start = current * size;

  return { items: items.slice(start, start + size), page: current, pageCount };
}

const TIER_LABELS: Readonly<Record<string, string>> = {
  tier1: 'Tier 1',
  tier2: 'Tier 2',
  tier3: 'Tier 3',
  prime: 'Prime',
};

export function formatDetail(entry: HistoryEntry): string {
  if (entry.detail === null) {
    return '';
  }

  switch (entry.type) {
    case 'sub':
    case 'resub':
      return TIER_LABELS[String(entry.detail)] ?? String(entry.detail);
    case 'bits':
      return `${String(entry.detail)} bits`;
    case 'gift':
      return `${String(entry.detail)} abonnements offerts`;
    case 'raid':
      return `${String(entry.detail)} spectateurs`;
    case 'follow':
      return String(entry.detail);
    case 'command':
      return `!${String(entry.detail)}`;
  }
}
