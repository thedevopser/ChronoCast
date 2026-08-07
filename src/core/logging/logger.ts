import type { Redactor } from './redaction.js';

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

export type LogContext = Record<string, unknown>;

export type LogContextProvider = LogContext | (() => LogContext);

export interface LogRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly context?: LogContext;
}

export interface LogSink {
  readonly name: string;
  write(record: LogRecord): void;
}

export interface Logger {
  debug(message: string, context?: LogContextProvider): void;
  info(message: string, context?: LogContextProvider): void;
  warning(message: string, context?: LogContextProvider): void;
  error(message: string, context?: LogContextProvider): void;
  child(scope: string): Logger;
}

export interface LoggerController extends Logger {
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
  addSink(sink: LogSink): void;
  removeSink(name: string): void;
  child(scope: string): Logger;
}

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly sinks: readonly LogSink[];
  readonly scope?: string;
  readonly redactor?: Redactor;
  readonly now?: () => Date;
  readonly onSinkError?: (error: unknown, sinkName: string) => void;
}

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
};

const SCOPE_SEPARATOR = ':';

interface LoggerCore {
  level: LogLevel;
  readonly sinks: LogSink[];
  readonly redactor: Redactor | undefined;
  readonly now: () => Date;
  readonly onSinkError: ((error: unknown, sinkName: string) => void) | undefined;
}

function resolveContext(provider: LogContextProvider | undefined): LogContext | undefined {
  if (provider === undefined) {
    return undefined;
  }

  if (typeof provider !== 'function') {
    return provider;
  }

  try {
    return provider();
  } catch (error) {
    return { contextError: error instanceof Error ? error.message : String(error) };
  }
}

function redactMessage(message: string, redactor: Redactor | undefined): string {
  if (redactor === undefined) {
    return message;
  }

  const redacted: unknown = redactor.redact(message);
  return typeof redacted === 'string' ? redacted : message;
}

function redactContext(
  context: LogContext | undefined,
  redactor: Redactor | undefined,
): LogContext | undefined {
  if (context === undefined) {
    return undefined;
  }

  if (redactor === undefined) {
    return context;
  }

  const redacted: unknown = redactor.redact(context);
  if (typeof redacted === 'object' && redacted !== null && !Array.isArray(redacted)) {
    return redacted as LogContext;
  }

  return { redacted: String(redacted) };
}

function createLoggerFacade(core: LoggerCore, scope: string): Logger {
  function emit(level: LogLevel, message: string, context?: LogContextProvider): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[core.level]) {
      return;
    }

    const resolvedContext = redactContext(resolveContext(context), core.redactor);

    const record: LogRecord =
      resolvedContext === undefined
        ? {
            timestamp: core.now().toISOString(),
            level,
            scope,
            message: redactMessage(message, core.redactor),
          }
        : {
            timestamp: core.now().toISOString(),
            level,
            scope,
            message: redactMessage(message, core.redactor),
            context: resolvedContext,
          };

    for (const sink of [...core.sinks]) {
      try {
        sink.write(record);
      } catch (error) {
        core.onSinkError?.(error, sink.name);
      }
    }
  }

  return {
    debug: (message, context) => {
      emit('debug', message, context);
    },
    info: (message, context) => {
      emit('info', message, context);
    },
    warning: (message, context) => {
      emit('warning', message, context);
    },
    error: (message, context) => {
      emit('error', message, context);
    },
    child: (childScope: string) =>
      createLoggerFacade(core, scope === '' ? childScope : `${scope}${SCOPE_SEPARATOR}${childScope}`),
  };
}

export function createLogger(options: LoggerOptions): LoggerController {
  const core: LoggerCore = {
    level: options.level,
    sinks: [...options.sinks],
    redactor: options.redactor,
    now: options.now ?? (() => new Date()),
    onSinkError: options.onSinkError,
  };

  const facade = createLoggerFacade(core, options.scope ?? '');

  return {
    ...facade,

    setLevel(level: LogLevel): void {
      core.level = level;
    },

    getLevel(): LogLevel {
      return core.level;
    },

    addSink(sink: LogSink): void {
      const existing = core.sinks.findIndex((candidate) => candidate.name === sink.name);
      if (existing >= 0) {
        core.sinks.splice(existing, 1, sink);
        return;
      }
      core.sinks.push(sink);
    },

    removeSink(name: string): void {
      const index = core.sinks.findIndex((candidate) => candidate.name === name);
      if (index >= 0) {
        core.sinks.splice(index, 1);
      }
    },
  };
}
