import { describe, expect, it } from 'vitest';

import { createConfigService } from '../../src/core/config/config-service.js';
import { DEFAULT_CONFIG } from '../../src/core/config/defaults.js';
import { configSchema, type ChronoCastConfig } from '../../src/core/config/schema.js';
import { createLogger } from '../../src/core/logging/logger.js';

describe('adresses Twitch', () => {
  it('ne se règlent pas par la configuration', () => {
    const parsed = configSchema.parse({
      twitch: {
        idBaseUrl: 'https://id-twitch.example',
        helixBaseUrl: 'https://helix.example/helix',
        eventsubUrl: 'wss://eventsub.example/ws',
      },
    });

    expect(parsed.twitch).not.toHaveProperty('idBaseUrl');
    expect(parsed.twitch).not.toHaveProperty('helixBaseUrl');
    expect(parsed.twitch).not.toHaveProperty('eventsubUrl');
  });
});

describe('import d’une configuration partagée', () => {
  it('ne change ni l’application Twitch, ni le compte, ni la lecture du chat', async () => {
    let persisted: ChronoCastConfig = {
      ...DEFAULT_CONFIG,
      twitch: { ...DEFAULT_CONFIG.twitch, clientId: 'mon-application', broadcasterUserId: '1337' },
    };
    const service = createConfigService({
      store: {
        filePath: '/mémoire/config.json',
        read: () => Promise.resolve(persisted),
        write: (value) => {
          persisted = value;
          return Promise.resolve();
        },
      },
      logger: createLogger({ level: 'error', sinks: [] }),
    });
    const before = (await service.load()).twitch;

    const imported = await service.import(
      JSON.stringify({
        twitch: {
          clientId: 'application-du-tiers',
          broadcasterUserId: '666',
          enableChatCommands: true,
          idBaseUrl: 'https://id-twitch.example',
        },
      }),
    );

    expect(imported.twitch).toStrictEqual(before);
    expect(persisted.twitch).toStrictEqual(before);
  });
});
