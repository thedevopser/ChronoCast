/**
 * Paire de serveurs de bouclage : IPv4 et IPv6.
 *
 * Elle n'existe que pour une raison, imposée de l'extérieur. Twitch n'accepte
 * une redirection en HTTP que vers le **nom** `localhost` — jamais vers
 * `127.0.0.1`, que sa console refuse en exigeant HTTPS. Or un nom se résout, et
 * sous Windows `localhost` mène souvent à `::1` avant `127.0.0.1`.
 *
 * Un serveur de rappel qui n'écouterait que l'adresse IPv4 laisserait donc le
 * navigateur frapper une adresse morte **après** que l'utilisateur a autorisé
 * l'application chez Twitch. C'est le pire moment pour échouer : tout ce qui
 * pouvait mal se passer est déjà derrière, l'utilisateur a fait sa part, et
 * rien à l'écran n'explique ce qui manque.
 *
 * Deux principes gouvernent ce module :
 *
 *   - **Il suffit qu'une adresse écoute.** IPv6 est parfois désactivé, IPv4
 *     parfois indisponible ; l'échec de l'une ne doit pas emporter le flux.
 *   - **Le bouclage reste strict.** Ces deux adresses, et aucune autre : le
 *     rappel OAuth n'a rien à faire sur le réseau local.
 */

/** Contrat minimal d'un serveur qu'on arme puis qu'on éteint. */
export interface ArmableServer {
  start(): Promise<number>;
  stop(): Promise<void>;
}

/** Les deux seules adresses admises, dans l'ordre où elles sont tentées. */
const LOOPBACK_HOSTS = ['127.0.0.1', '::1'] as const;

export interface LoopbackPairOptions {
  /** Fabrique un serveur lié à l'hôte donné. */
  createFor(host: string): ArmableServer;
}

export function createLoopbackPair(options: LoopbackPairOptions): ArmableServer {
  const servers = LOOPBACK_HOSTS.map((host) => options.createFor(host));

  return {
    async start(): Promise<number> {
      const outcomes = await Promise.allSettled(servers.map((server) => server.start()));

      const listening = outcomes.find((outcome) => outcome.status === 'fulfilled');
      if (listening === undefined) {
        // Aucune des deux n'écoute : port occupé, droits manquants. Mieux vaut
        // une erreur franche au clic qu'un flux parti vers Twitch pour revenir
        // sur un serveur qui n'existe pas. La première cause est remontée
        // telle quelle, c'est celle qui décrit le mieux le problème.
        const first = outcomes[0];
        throw first?.status === 'rejected'
          ? (first.reason as Error)
          : new Error('aucune adresse de bouclage disponible pour le rappel OAuth');
      }

      return listening.value;
    },

    async stop(): Promise<void> {
      // `allSettled` et non `all` : arrêter le second ne doit pas dépendre du
      // premier, et un serveur qui n'a jamais pris son port peut refuser de se
      // fermer. Cet arrêt survient pendant l'extinction du flux OAuth — y
      // lever masquerait la raison réelle de cette extinction.
      await Promise.allSettled(servers.map((server) => server.stop()));
    },
  };
}
