// Figées à dessein : une adresse réglable laisserait un fichier importé envoyer le refresh token et le secret client ailleurs.
export const TWITCH_ENDPOINTS = {
  id: 'https://id.twitch.tv',
  helix: 'https://api.twitch.tv/helix',
  eventsub: 'wss://eventsub.wss.twitch.tv/ws',
} as const;

const TWITCH_HOST = 'twitch.tv';

export function isTwitchEventSubUrl(candidate: string): boolean {
  if (!URL.canParse(candidate)) {
    return false;
  }

  const { protocol, hostname } = new URL(candidate);
  if (protocol !== 'wss:') {
    return false;
  }

  return hostname === TWITCH_HOST || hostname.endsWith(`.${TWITCH_HOST}`);
}
