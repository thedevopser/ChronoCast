import { goalProgressRatio } from '../shared/goal-progress.js';
import type { GoalMessage, GoalOverlayConfig } from '../shared/protocol.js';

export interface GoalDisplay {
  /** Faux sur une échelle sans aucun palier : la page se tait plutôt que de dessiner une barre. */
  readonly visible: boolean;

  readonly label: string;

  /** « 12 / 50 », ou vide quand le réglage éteint le compte. */
  readonly count: string;

  readonly progress: number;
}

export interface GoalAnnouncement {
  readonly id: string;
  readonly text: string;
  readonly label: string;
}

const EMPTY_LADDER_INDEX = -1;

export function goalDisplay(message: GoalMessage, config: GoalOverlayConfig): GoalDisplay {
  return {
    visible: message.index !== EMPTY_LADDER_INDEX,
    label: message.label,
    count: config.showCount ? `${String(message.subs)} / ${String(message.to)}` : '',
    progress: message.complete ? 1 : goalProgressRatio(message),
  };
}

/**
 * Les paliers à annoncer, dans l'ordre où ils ont été franchis.
 *
 * Le seuil sert d'identité : la file d'affichage distingue ses éléments par leur `id`, et deux
 * paliers franchis par le même don doivent s'enchaîner plutôt que de se confondre.
 */
export function announcementsOf(
  message: GoalMessage,
  config: GoalOverlayConfig,
): readonly GoalAnnouncement[] {
  if (!config.announce.enabled) {
    return [];
  }

  return message.crossed.map((tier) => ({
    id: `palier-${String(tier.target)}`,
    text: config.announce.text,
    label: tier.label,
  }));
}
