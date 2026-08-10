import type { LogLevel, LogRecord, LogSink } from '../logger.js';

export interface ConsoleSinkOptions {
  readonly writeOut?: (line: string) => void;

  readonly writeError?: (line: string) => void;
}

const LEVEL_WIDTH = 7;

const ERROR_LEVELS: ReadonlySet<LogLevel> = new Set<LogLevel>(['error']);

export function createConsoleSink(options: ConsoleSinkOptions = {}): LogSink {
  const writeOut =
    options.writeOut ??
    ((line: string): void => {
      process.stdout.write(line);
    });

  const writeError =
    options.writeError ??
    ((line: string): void => {
      process.stderr.write(line);
    });

  return {
    name: 'console',

    write(record: LogRecord): void {
      const level = record.level.toUpperCase().padEnd(LEVEL_WIDTH, ' ');
      const scope = record.scope === '' ? '' : `[${record.scope}] `;

      let suffix = '';
      if (record.context !== undefined) {
        try {
          suffix = ` ${JSON.stringify(record.context)}`;
        } catch {
          suffix = ' [contexte non sérialisable]';
        }
      }

      const line = `${record.timestamp} ${level} ${scope}${record.message}${suffix}\n`;

      if (ERROR_LEVELS.has(record.level)) {
        writeError(line);
        return;
      }
      writeOut(line);
    },
  };
}
