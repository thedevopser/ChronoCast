export interface PermissionPolicyOptions {
  readonly appOrigin: string;
}

// Electron accorde par défaut toute demande de permission. Seule l'écriture du presse-papiers
// est nécessaire, aux boutons « Copier » du panneau et de l'assistant.
const GRANTED_TO_APP: ReadonlySet<string> = new Set(['clipboard-sanitized-write']);

export function decidePermission(
  permission: string,
  requestingUrl: string,
  options: PermissionPolicyOptions,
): boolean {
  if (!GRANTED_TO_APP.has(permission) || !URL.canParse(requestingUrl)) {
    return false;
  }

  return new URL(requestingUrl).origin === options.appOrigin;
}
