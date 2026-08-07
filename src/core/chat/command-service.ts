/**
 * Décision d'une commande de chat.
 *
 * Seul module de la chaîne qui décide : il résout la commande dans la
 * configuration, vérifie l'habilitation, convertit l'argument et applique le
 * plafond. Fonction pure — configuration et charge utile entrent, un événement
 * ou un refus sortent. Ni horloge, ni état, ni entrées-sorties.
 *
 * **Aucun message n'est écarté sur l'identité de son auteur.** Le compte
 * authentifié qui lit le chat est, dans le cas courant, celui du streamer
 * lui-même : ignorer ses propres lignes lui refuserait sa propre commande, sur
 * sa propre chaîne. Et comme ChronoCast **n'écrit jamais dans le chat**, il ne
 * peut produire aucun message susceptible de le redéclencher. Seul le badge
 * décide.
 *
 * **Le filtrage est précoce, et c'est une décision anti-abus.** Tout ce qui
 * n'aboutit pas est écarté ici, avant l'historique et avant le WebSocket. Sans
 * cela, un spectateur martelant la commande remplirait l'historique du streamer
 * une ligne à la fois, et chaque ligne du chat traverserait le pipeline entier.
 *
 * **Aucun refus n'est une erreur.** `channel.chat.message` livre *chaque*
 * message de la chaîne, dont la quasi-totalité n'a rien à voir avec ChronoCast :
 * ces refus se journalisent en `debug` et ne s'affichent nulle part.
 *
 * Le module ne lève jamais. La charge utile vient du réseau, et une exception
 * ici abattrait le traitement de la notification — donc le pipeline qui porte
 * tout le subathon.
 */

import type { ChronoCastConfig } from '../config/schema.js';
import type { CommandEvent } from '../events/domain-event.js';
import { isPrivileged } from './chatter-badges.js';
import { parseCommand } from './command-parser.js';

/** Contexte d'arrivée, issu de l'enveloppe EventSub. */
export interface ChatMessageContext {
  /** `metadata.message_id`, repris tel quel comme identifiant de l'événement. */
  readonly messageId: string;

  /** Instant de réception, en millisecondes depuis l'époque. */
  readonly receivedAt: number;
}

/**
 * Issue de l'évaluation.
 *
 * Un seul cas de rejet, et non le couple `ignored` / `invalid` du convertisseur
 * d'événements : ici, une charge utile inattendue et un simple « bonjour » se
 * traitent pareil. Un message de chat qui ne dit rien à ChronoCast est le cas
 * **nominal**, pas un décalage avec le protocole.
 */
export type CommandOutcome =
  | { readonly kind: 'event'; readonly event: CommandEvent }
  | { readonly kind: 'ignored'; readonly reason: string };

/**
 * Longueur maximale d'un pseudo retenu.
 *
 * Le nom affiché est choisi par un tiers non fiable et traverse jusqu'à
 * l'overlay. `safe-dom` le tronque déjà à l'écriture, mais le borner ici évite
 * qu'une chaîne démesurée soit persistée dans l'historique et rediffusée à
 * chaque relecture.
 */
const MAX_USER_NAME_LENGTH = 100;

/** Entier décimal, signe négatif compris. Rien d'autre. */
const DECIMAL_INTEGER = /^-?\d+$/u;

function ignored(reason: string): CommandOutcome {
  return { kind: 'ignored', reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lit une chaîne non vide, ou `undefined`. */
function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Convertit l'argument d'une commande en secondes.
 *
 * Volontairement étroit, et le refus est le comportement sûr. `Number()`
 * accepterait `0x10`, `1e3`, `2.5`, `Infinity` et les chiffres arabes de pleine
 * chasse — autant de valeurs qu'un modérateur n'a pas voulu taper, et dont
 * aucune ne doit se retrouver au compteur.
 */
function readSeconds(argument: string): number | null {
  if (!DECIMAL_INTEGER.test(argument)) {
    return null;
  }

  const parsed = Number(argument);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Décide du sort d'un message de chat.
 *
 * @param context Enveloppe du message.
 * @param payload Charge utile `channel.chat.message`, jamais présumée valide.
 * @param config Configuration courante, relue à chaque message.
 */
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
    // Sans auteur identifiable, l'habilitation ne se rattache à personne et
    // l'historique porterait une ligne anonyme. Le refus est le comportement sûr.
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

  const settings = config.rewards.chatCommand;
  if (parsed.name !== settings.name.toLowerCase()) {
    return ignored(`commande « ${parsed.name} » inconnue`);
  }

  // L'habilitation se vérifie **après** avoir reconnu la commande, et non
  // avant : la journaliser pour chaque message ordinaire d'un modérateur
  // noierait la seule ligne qui compte.
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
    // Le périmètre est l'ajout seul. `applyAdd` ignorerait de toute façon un
    // delta négatif ou nul **sans rien signaler** : le compteur ne bougerait
    // pas alors que l'historique dirait l'événement appliqué.
    return ignored(`!${parsed.name} : une durée doit être strictement positive`);
  }

  if (seconds > settings.maxSeconds) {
    // Refus et non écrêtage : une valeur hors bornes est une faute de frappe
    // bien plus souvent qu'une intention, et créditer une heure à qui en
    // voulait dix obligerait à corriger le compteur à la main, en direct.
    return ignored(
      `!${parsed.name} : ${String(seconds)} s au-delà du plafond de ${String(settings.maxSeconds)} s`,
    );
  }

  return {
    kind: 'event',
    event: {
      // Le `message_id` de l'enveloppe : c'est lui qui empêche un message
      // rejoué par Twitch d'être crédité deux fois.
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
