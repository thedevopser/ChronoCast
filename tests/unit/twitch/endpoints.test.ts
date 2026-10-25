import { describe, expect, it } from 'vitest';

import { isTwitchEventSubUrl } from '../../../src/core/twitch/endpoints.js';

describe('isTwitchEventSubUrl', () => {
  it.each([
    'wss://eventsub.wss.twitch.tv/ws?challenge=xyz',
    'wss://twitch.tv/ws',
  ])('accepte %s', (url) => {
    expect(isTwitchEventSubUrl(url)).toBe(true);
  });

  it.each([
    ['un autre hôte', 'wss://eventsub.example/ws'],
    ['un hôte qui ne fait que finir par twitch.tv', 'wss://eviltwitch.tv/ws'],
    ['un hôte qui contient twitch.tv', 'wss://eventsub.wss.twitch.tv.example/ws'],
    ['des identifiants qui masquent l’hôte', 'wss://eventsub.wss.twitch.tv@evil.example/ws'],
    ['une connexion non chiffrée', 'ws://eventsub.wss.twitch.tv/ws'],
    ['un autre protocole', 'https://eventsub.wss.twitch.tv/ws'],
    ['une adresse illisible', 'pas une adresse'],
  ])('refuse %s', (_cas, url) => {
    expect(isTwitchEventSubUrl(url)).toBe(false);
  });
});
