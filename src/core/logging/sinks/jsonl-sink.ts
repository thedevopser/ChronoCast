import type { LogRecord, LogSink } from '../logger.js';

export interface LogRecordAppender {
  append(record: LogRecord): Promise<void>;
}

export interface JsonlSinkOptions {
  readonly store: LogRecordAppender;

  readonly onError?: (error: unknown) => void;
}

export interface JsonlSink extends LogSink {
  flush(): Promise<void>;
}

export function createJsonlSink(options: JsonlSinkOptions): JsonlSink {
  const { store, onError } = options;

  let queue: Promise<void> = Promise.resolve();

  return {
    name: 'jsonl',

    write(record: LogRecord): void {
      queue = queue.then(async () => {
        try {
          await store.append(record);
        } catch (error) {
          onError?.(error);
        }
      });
    },

    async flush(): Promise<void> {
      await queue;
    },
  };
}
