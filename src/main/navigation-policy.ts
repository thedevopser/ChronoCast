import { DONATION_URL, REPOSITORY_URL } from '../core/app/about.js';

export type NavigationDecision = 'allow' | 'external' | 'block';

export interface NavigationPolicyOptions {
  readonly appOrigin: string;
}

const TWITCH_HOSTS: ReadonlySet<string> = new Set([
  'id.twitch.tv',
  'dev.twitch.tv',
  'twitch.tv',
  'www.twitch.tv',
]);

/**
 * Hôtes du dépôt et de la page de soutien, dérivés des URL publiées plutôt que recopiés :
 * une URL changée dans `about.ts` autorise le nouvel hôte du même geste. Sans cela, un lien
 * mis à jour serait bloqué en silence, sans le moindre message à l'utilisateur.
 */
const SUPPORT_HOSTS: ReadonlySet<string> = new Set(
  [REPOSITORY_URL, DONATION_URL].map((url) => new URL(url).hostname),
);

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function decideNavigation(
  url: string,
  options: NavigationPolicyOptions,
): NavigationDecision {
  const target = parse(url);
  if (target === null) {
    return 'block';
  }

  const expected = parse(options.appOrigin);
  if (expected !== null && target.origin === expected.origin) {
    return 'allow';
  }

  const externallyAllowed =
    TWITCH_HOSTS.has(target.hostname) || SUPPORT_HOSTS.has(target.hostname);

  if (target.protocol === 'https:' && target.port === '' && externallyAllowed) {
    return 'external';
  }

  return 'block';
}
