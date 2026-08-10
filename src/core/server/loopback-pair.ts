export interface ArmableServer {
  start(): Promise<number>;
  stop(): Promise<void>;
}

const LOOPBACK_HOSTS = ['127.0.0.1', '::1'] as const;

export interface LoopbackPairOptions {
  createFor(host: string): ArmableServer;
}

export function createLoopbackPair(options: LoopbackPairOptions): ArmableServer {
  const servers = LOOPBACK_HOSTS.map((host) => options.createFor(host));

  return {
    async start(): Promise<number> {
      const outcomes = await Promise.allSettled(servers.map((server) => server.start()));

      const listening = outcomes.find((outcome) => outcome.status === 'fulfilled');
      if (listening === undefined) {
        const first = outcomes[0];
        throw first?.status === 'rejected'
          ? (first.reason as Error)
          : new Error('aucune adresse de bouclage disponible pour le rappel OAuth');
      }

      return listening.value;
    },

    async stop(): Promise<void> {
      await Promise.allSettled(servers.map((server) => server.stop()));
    },
  };
}
