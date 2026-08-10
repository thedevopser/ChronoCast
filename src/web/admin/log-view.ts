export interface LogRecord {
  readonly timestamp: string;
  readonly level: string;
  readonly scope: string;
  readonly message: string;
  readonly context?: unknown;
}

export const MAX_LOG_RECORDS = 2_000;

const LEVELS: readonly string[] = ['debug', 'info', 'warning', 'error'];

export interface LogBuffer {
  readonly records: readonly LogRecord[];
}

export function createLogBuffer(): LogBuffer {
  return { records: [] };
}

export function appendRecords(buffer: LogBuffer, records: readonly LogRecord[]): LogBuffer {
  if (records.length === 0) {
    return buffer;
  }

  const merged = [...buffer.records, ...records];
  return { records: merged.slice(Math.max(0, merged.length - MAX_LOG_RECORDS)) };
}

export interface LogFilter {
  readonly level?: string;
  readonly scope?: string;
  readonly search?: string;
}

export function filterRecords(
  records: readonly LogRecord[],
  filter: LogFilter,
): readonly LogRecord[] {
  const threshold = LEVELS.indexOf(filter.level ?? '');
  const scope = filter.scope?.trim() ?? '';
  const search = filter.search?.trim().toLowerCase() ?? '';

  return records.filter((record) => {
    if (threshold >= 0 && LEVELS.indexOf(record.level) < threshold) {
      return false;
    }

    if (scope !== '' && !record.scope.startsWith(scope)) {
      return false;
    }

    return search === '' || record.message.toLowerCase().includes(search);
  });
}

export function scopesOf(records: readonly LogRecord[]): readonly string[] {
  return [...new Set(records.map((record) => record.scope))].sort((left, right) =>
    left.localeCompare(right),
  );
}
