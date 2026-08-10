export type EventMap = Record<string, unknown>;

export type Unsubscribe = () => void;

export interface EventBus<TEvents extends EventMap> {
  on<K extends keyof TEvents & string>(
    type: K,
    handler: (payload: TEvents[K]) => void,
  ): Unsubscribe;

  once<K extends keyof TEvents & string>(
    type: K,
    handler: (payload: TEvents[K]) => void,
  ): Unsubscribe;

  emit<K extends keyof TEvents & string>(type: K, payload: TEvents[K]): void;

  clear(): void;
}

export interface EventBusOptions {
  readonly onHandlerError?: (error: unknown, type: string) => void;
}

interface Subscription {
  readonly handler: (payload: never) => void;
}

export function createEventBus<TEvents extends EventMap>(
  options: EventBusOptions = {},
): EventBus<TEvents> {
  const { onHandlerError } = options;

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

      const snapshot = [...current];

      for (const subscription of snapshot) {
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
