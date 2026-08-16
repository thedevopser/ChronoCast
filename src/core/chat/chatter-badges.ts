const BROADCASTER_BADGE = 'broadcaster';

const PRIVILEGED_BADGES: ReadonlySet<string> = new Set([BROADCASTER_BADGE, 'moderator']);

function wears(badges: unknown, wanted: ReadonlySet<string>): boolean {
  if (!Array.isArray(badges)) {
    return false;
  }

  return badges.some((badge) => {
    if (typeof badge !== 'object' || badge === null) {
      return false;
    }
    const setId = (badge as { set_id?: unknown }).set_id;
    return typeof setId === 'string' && wanted.has(setId);
  });
}

export function isPrivileged(badges: unknown): boolean {
  return wears(badges, PRIVILEGED_BADGES);
}

const BROADCASTER_ONLY: ReadonlySet<string> = new Set([BROADCASTER_BADGE]);

export function isBroadcaster(badges: unknown): boolean {
  return wears(badges, BROADCASTER_ONLY);
}
