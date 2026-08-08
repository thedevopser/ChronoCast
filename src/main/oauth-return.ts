import type { OAuthOutcome } from '../core/server/oauth-callback.js';

const RETURNABLE_PATHS = new Set(['/setup', '/admin']);

const DEFAULT_PATH = '/setup';

export interface OAuthReturnOptions {
  readonly appOrigin: string;
  readonly currentUrl: string;
  readonly outcome: OAuthOutcome;
}

export function oauthReturnUrl(options: OAuthReturnOptions): string {
  const { appOrigin, currentUrl, outcome } = options;

  return `${appOrigin}${currentPath(appOrigin, currentUrl)}?oauth=${outcome}`;
}

function currentPath(appOrigin: string, currentUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(currentUrl);
  } catch {
    return DEFAULT_PATH;
  }

  if (parsed.origin !== appOrigin) {
    return DEFAULT_PATH;
  }

  return RETURNABLE_PATHS.has(parsed.pathname) ? parsed.pathname : DEFAULT_PATH;
}
