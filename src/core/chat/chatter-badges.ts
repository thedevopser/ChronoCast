const PRIVILEGED_BADGES: ReadonlySet<string> = new Set(['broadcaster', 'moderator']);

export function isPrivileged(badges: unknown): boolean {
  if (!Array.isArray(badges)) {
    return false;
  }

  return badges.some((badge) => {
    if (typeof badge !== 'object' || badge === null) {
      return false;
    }
    const setId = (badge as { set_id?: unknown }).set_id;
    return typeof setId === 'string' && PRIVILEGED_BADGES.has(setId);
  });
}
