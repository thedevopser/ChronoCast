import type { ChronoCastConfig } from '../config/schema.js';
import type { CommandEvent } from '../events/domain-event.js';
import { isBroadcaster, isPrivileged } from './chatter-badges.js';
import { parseCommand } from './command-parser.js';

export interface ChatMessageContext {
  readonly messageId: string;

  readonly receivedAt: number;
}

export type CounterAction = 'pause' | 'resume';

export type CommandOutcome =
  | { readonly kind: 'event'; readonly event: CommandEvent }
  | { readonly kind: 'action'; readonly action: CounterAction }
  | { readonly kind: 'ignored'; readonly reason: string };

// Figés dans le code, comme le préfixe « ! » : un nom réglable serait une question de support de plus.
const COUNTER_ACTIONS: Readonly<Record<string, CounterAction>> = {
  pause: 'pause',
  reprendre: 'resume',
};

const MAX_USER_NAME_LENGTH = 100;

const DECIMAL_INTEGER = /^-?\d+$/u;

function ignored(reason: string): CommandOutcome {
  return { kind: 'ignored', reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function readSeconds(argument: string): number | null {
  if (!DECIMAL_INTEGER.test(argument)) {
    return null;
  }

  const parsed = Number(argument);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function evaluateChatMessage(
  context: ChatMessageContext,
  payload: unknown,
  config: ChronoCastConfig,
): CommandOutcome {
  if (!config.twitch.enableChatCommands) {
    return ignored('commandes de chat désactivées');
  }

  if (!isRecord(payload)) {
    return ignored(`charge utile inattendue : ${typeof payload}`);
  }

  const userId = readString(payload, 'chatter_user_id');
  if (userId === undefined) {
    return ignored("message de chat sans identifiant d'auteur");
  }

  const message = payload['message'];
  const text = isRecord(message) ? message['text'] : undefined;
  if (typeof text !== 'string') {
    return ignored('message de chat sans texte');
  }

  const parsed = parseCommand(text);
  if (parsed === null) {
    return ignored('message ordinaire');
  }

  // Résolues avant le barème : l'import de configuration reste permissif, et un « name » valant
  // « pause » ne doit pas pouvoir masquer la commande réservée.
  const action = COUNTER_ACTIONS[parsed.name];
  if (action !== undefined) {
    if (!isBroadcaster(payload['badges'])) {
      return ignored(`!${parsed.name} refusée : auteur autre que le diffuseur`);
    }

    return { kind: 'action', action };
  }

  const settings = config.rewards.chatCommand;
  if (parsed.name !== settings.name.toLowerCase()) {
    return ignored(`commande « ${parsed.name} » inconnue`);
  }

  if (!isPrivileged(payload['badges'])) {
    return ignored(`!${parsed.name} refusée : auteur ni diffuseur ni modérateur`);
  }

  if (parsed.argument === null) {
    return ignored(`!${parsed.name} sans valeur`);
  }

  const seconds = readSeconds(parsed.argument);
  if (seconds === null) {
    return ignored(`!${parsed.name} : « ${parsed.argument} » n'est pas un nombre entier`);
  }

  if (seconds <= 0) {
    return ignored(`!${parsed.name} : une durée doit être strictement positive`);
  }

  if (seconds > settings.maxSeconds) {
    return ignored(
      `!${parsed.name} : ${String(seconds)} s au-delà du plafond de ${String(settings.maxSeconds)} s`,
    );
  }

  return {
    kind: 'event',
    event: {
      id: context.messageId,
      type: 'command',
      command: parsed.name,
      seconds,
      occurredAt: context.receivedAt,
      userId,
      userName: (readString(payload, 'chatter_user_name') ?? userId).slice(0, MAX_USER_NAME_LENGTH),
      source: 'chat-command',
    },
  };
}
