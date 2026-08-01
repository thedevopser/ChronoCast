/**
 * Bus d'événements typé.
 *
 * Colonne vertébrale de l'application : le client EventSub, le service compteur,
 * le serveur WebSocket et le panneau d'administration ne se connaissent pas et ne
 * communiquent que par ce canal. C'est ce qui permet d'ajouter un consommateur
 * — une notification systray, un webhook local — sans toucher aux producteurs.
 *
 * Deux garanties structurent la diffusion :
 *
 *   - **Un abonné défaillant n'empêche jamais les autres d'être notifiés.** Si la
 *     diffusion vers l'overlay échoue, la persistance du compteur doit malgré
 *     tout avoir lieu.
 *   - **La liste des abonnés est figée au début de la diffusion**, mais un
 *     désabonnement prend effet immédiatement. Un abonné inscrit pendant le
 *     traitement d'un événement ne le reçoit donc pas — il n'existait pas quand
 *     il a été émis — tandis qu'un abonné qui se détache n'est plus appelé.
 */

/** Contrat d'un catalogue d'événements : un nom, une charge utile. */
export type EventMap = Record<string, unknown>;

/** Fonction de désabonnement rendue à l'inscription. */
export type Unsubscribe = () => void;

export interface EventBus<TEvents extends EventMap> {
  /** Inscrit un abonné. Renvoie de quoi le retirer. */
  on<K extends keyof TEvents & string>(
    type: K,
    handler: (payload: TEvents[K]) => void,
  ): Unsubscribe;

  /** Inscrit un abonné retiré automatiquement après sa première notification. */
  once<K extends keyof TEvents & string>(
    type: K,
    handler: (payload: TEvents[K]) => void,
  ): Unsubscribe;

  /** Diffuse un événement à tous ses abonnés. */
  emit<K extends keyof TEvents & string>(type: K, payload: TEvents[K]): void;

  /** Retire tous les abonnés, tous types confondus. */
  clear(): void;
}

export interface EventBusOptions {
  /**
   * Notification de la défaillance d'un abonné.
   *
   * Sans elle, l'exception est silencieusement absorbée : c'est acceptable pour
   * ne pas interrompre la diffusion, mais l'application doit pouvoir la
   * journaliser.
   */
  readonly onHandlerError?: (error: unknown, type: string) => void;
}

/**
 * Enveloppe d'abonné.
 *
 * L'identité de l'enveloppe, et non celle de la fonction, sert de clé : un même
 * abonné peut ainsi être inscrit deux fois et retiré une seule.
 */
interface Subscription {
  readonly handler: (payload: never) => void;
}

export function createEventBus<TEvents extends EventMap>(
  options: EventBusOptions = {},
): EventBus<TEvents> {
  const { onHandlerError } = options;

  /** Abonnés par type d'événement, dans leur ordre d'inscription. */
  const subscriptions = new Map<string, Subscription[]>();

  function subscribe(type: string, handler: (payload: never) => void): Unsubscribe {
    const subscription: Subscription = { handler };

    const existing = subscriptions.get(type);
    if (existing === undefined) {
      subscriptions.set(type, [subscription]);
    } else {
      existing.push(subscription);
    }

    let removed = false;
    return () => {
      // Idempotent : appeler deux fois la fonction de désabonnement ne doit pas
      // retirer par erreur une autre inscription du même abonné.
      if (removed) {
        return;
      }
      removed = true;

      const current = subscriptions.get(type);
      if (current === undefined) {
        return;
      }

      const index = current.indexOf(subscription);
      if (index >= 0) {
        current.splice(index, 1);
      }

      if (current.length === 0) {
        subscriptions.delete(type);
      }
    };
  }

  return {
    on<K extends keyof TEvents & string>(
      type: K,
      handler: (payload: TEvents[K]) => void,
    ): Unsubscribe {
      return subscribe(type, handler);
    },

    once<K extends keyof TEvents & string>(
      type: K,
      handler: (payload: TEvents[K]) => void,
    ): Unsubscribe {
      const unsubscribe = subscribe(type, (payload: TEvents[K]) => {
        // Retrait avant appel : si l'abonné lève, il ne doit pas rester inscrit.
        unsubscribe();
        handler(payload);
      });

      return unsubscribe;
    },

    emit<K extends keyof TEvents & string>(type: K, payload: TEvents[K]): void {
      const current = subscriptions.get(type);
      if (current === undefined || current.length === 0) {
        return;
      }

      // Instantané : un abonné inscrit pendant la diffusion ne reçoit pas
      // l'événement en cours, et modifier la liste ne casse pas l'itération.
      const snapshot = [...current];

      for (const subscription of snapshot) {
        // Vérification d'appartenance : un abonné retiré par un abonné précédent
        // ne doit pas être appelé, alors qu'il figure encore dans l'instantané.
        if (subscriptions.get(type)?.includes(subscription) !== true) {
          continue;
        }

        try {
          (subscription.handler as (value: TEvents[K]) => void)(payload);
        } catch (error) {
          onHandlerError?.(error, type);
        }
      }
    },

    clear(): void {
      subscriptions.clear();
    },
  };
}
