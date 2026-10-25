import { describe, expect, it } from 'vitest';

import { configSchema } from '../../src/core/config/schema.js';

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
