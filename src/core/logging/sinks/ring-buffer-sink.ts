import type { LogRecord, LogSink } from '../logger.js';

export interface RingBufferSink extends LogSink {
  snapshot(limit?: number): LogRecord[];

  clear(): void;
}

export function createRingBufferSink(capacity: number): RingBufferSink {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`capacité invalide : ${String(capacity)} (entier positif attendu)`);
  }

  let records: LogRecord[] = [];

  return {
    name: 'ring-buffer',

    write(record: LogRecord): void {
      records.push(record);
      if (records.length > capacity) {
        records.shift();
      }
    },

    snapshot(limit?: number): LogRecord[] {
      if (limit === undefined) {
        return [...records];
      }
      if (limit <= 0) {
        return [];
      }
      return records.slice(-limit);
    },

    clear(): void {
      records = [];
    },
  };
}
