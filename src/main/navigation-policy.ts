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

  if (target.protocol === 'https:' && target.port === '' && TWITCH_HOSTS.has(target.hostname)) {
    return 'external';
  }

  return 'block';
}
