// Figées à dessein : une adresse réglable laisserait un fichier importé envoyer le refresh token et le secret client ailleurs.
export const TWITCH_ENDPOINTS = {
  id: 'https://id.twitch.tv',
  helix: 'https://api.twitch.tv/helix',
  eventsub: 'wss://eventsub.wss.twitch.tv/ws',
} as const;
