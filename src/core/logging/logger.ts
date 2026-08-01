/**
 * Système de journalisation de ChronoCast.
 *
 * L'application tourne sans terminal : ces enregistrements sont le seul canal de
 * diagnostic dont dispose l'utilisateur, et ils alimentent directement la vue
 * « Logs » du panneau d'administration.
 *
 * Trois propriétés structurent la conception :
 *
 *   - **Un puits défaillant n'interrompt jamais l'appelant.** Écrire un log est
 *     une opération accessoire ; qu'un disque soit plein ne doit pas faire
 *     échouer le traitement d'un événement Twitch.
 *   - **Aucun secret ne franchit cette frontière.** Tout message et tout contexte
 *     passent par le rédacteur avant d'atteindre un puits.
 *   - **Le coût d'un log filtré est nul.** Le contexte peut être fourni sous
 *     forme de fonction, qui n'est évaluée que si l'enregistrement est retenu.
 */

import type { Redactor } from './redaction.js';

/** Niveaux de gravité, du plus verbeux au plus grave. */
export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

/** Données structurées accompagnant un message. */
export type LogContext = Record<string, unknown>;

/**
 * Contexte fourni directement, ou différé.
 *
 * La forme différée évite de construire un objet coûteux pour un enregistrement
 * qui sera de toute façon filtré par le niveau courant.
 */
export type LogContextProvider = LogContext | (() => LogContext);

/** Enregistrement tel qu'il parvient aux puits, déjà expurgé. */
export interface LogRecord {
  /** Horodatage ISO 8601 en UTC. */
  readonly timestamp: string;
  readonly level: LogLevel;
  /** Chemin du composant émetteur, par exemple `twitch:eventsub`. */
  readonly scope: string;
  readonly message: string;
  readonly context?: LogContext;
}

/** Destination d'écriture : console, fichier JSONL, tampon circulaire… */
export interface LogSink {
  /** Identifiant unique, utilisé par {@link LoggerController.removeSink}. */
  readonly name: string;
  write(record: LogRecord): void;
}

/** Interface d'émission, seule surface exposée aux composants métier. */
export interface Logger {
  debug(message: string, context?: LogContextProvider): void;
  info(message: string, context?: LogContextProvider): void;
  warning(message: string, context?: LogContextProvider): void;
  error(message: string, context?: LogContextProvider): void;
  /** Crée un logger dont la portée est préfixée par celle du parent. */
  child(scope: string): Logger;
}

/**
 * Interface d'administration, réservée à la composition de l'application.
 *
 * Les composants métier ne reçoivent qu'un {@link Logger} : ils ne doivent pas
 * pouvoir changer le niveau global ni brancher un puits.
 */
export interface LoggerController extends Logger {
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
  addSink(sink: LogSink): void;
  /** Retire le puits portant ce nom. Sans effet s'il est absent. */
  removeSink(name: string): void;
  child(scope: string): Logger;
}

export interface LoggerOptions {
  /** Niveau minimal retenu à la création. Modifiable ensuite à chaud. */
  readonly level: LogLevel;
  readonly sinks: readonly LogSink[];
  /** Portée racine. Vide par défaut. */
  readonly scope?: string;
  /** Sans rédacteur, les valeurs sont écrites telles quelles. */
  readonly redactor?: Redactor;
  /** Source d'horodatage, injectée pour rendre les tests déterministes. */
  readonly now?: () => Date;
  /**
   * Notification d'échec d'un puits.
   *
   * Volontairement pas un log : journaliser l'échec de la journalisation
   * provoquerait une récursion infinie si le puits fautif est le seul branché.
   */
  readonly onSinkError?: (error: unknown, sinkName: string) => void;
}

/** Poids des niveaux, du plus verbeux au plus grave. */
const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
};

/** Séparateur des portées imbriquées. */
const SCOPE_SEPARATOR = ':';

/**
 * État partagé entre le logger racine et tous ses enfants.
 *
 * Le partage est délibéré : changer le niveau depuis le panneau
 * d'administration doit prendre effet immédiatement dans tout l'arbre, sans
 * avoir à retrouver les loggers enfants un par un.
 */
interface LoggerCore {
  level: LogLevel;
  readonly sinks: LogSink[];
  readonly redactor: Redactor | undefined;
  readonly now: () => Date;
  readonly onSinkError: ((error: unknown, sinkName: string) => void) | undefined;
}

/** Résout un contexte éventuellement différé, sans laisser fuiter d'exception. */
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
    // Un contexte qui ne sait pas se construire ne doit pas faire disparaître le
    // message : on conserve l'enregistrement en signalant le problème.
    return { contextError: error instanceof Error ? error.message : String(error) };
  }
}

/** Applique la rédaction à un message, en garantissant qu'il reste une chaîne. */
function redactMessage(message: string, redactor: Redactor | undefined): string {
  if (redactor === undefined) {
    return message;
  }

  const redacted: unknown = redactor.redact(message);
  return typeof redacted === 'string' ? redacted : message;
}

/** Applique la rédaction à un contexte, en garantissant qu'il reste un objet. */
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

  // Cas théorique : la rédaction n'est pas censée changer la forme d'un objet.
  // On préfère perdre la structure plutôt que d'émettre une valeur inattendue.
  return { redacted: String(redacted) };
}

function createLoggerFacade(core: LoggerCore, scope: string): Logger {
  function emit(level: LogLevel, message: string, context?: LogContextProvider): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[core.level]) {
      return;
    }

    const resolvedContext = redactContext(resolveContext(context), core.redactor);

    // La propriété `context` est ajoutée conditionnellement plutôt qu'assignée à
    // `undefined` : un puits JSONL écrirait sinon une clé vide dans chaque ligne.
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

    // Copie du tableau : un puits qui en ajouterait ou en retirerait un autre
    // pendant la diffusion ne doit pas corrompre l'itération en cours.
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
      // Un même nom deux fois écrirait chaque enregistrement en double et
      // rendrait `removeSink` ambigu : le dernier branché remplace le précédent.
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
