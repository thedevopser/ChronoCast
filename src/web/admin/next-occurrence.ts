/**
 * Le seul module qui connaît le fuseau local : il résout une heure saisie en horodatage absolu, et
 * met un horodatage en clair. Le noyau, lui, ne compare que des instants.
 */
export interface ResolvedWindow {
  readonly startAt: number;
  readonly endAt: number;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function localTime(reference: number, dayOffset: number, hours: number, minutes: number): number {
  const day = new Date(reference);

  // Le constructeur absorbe lui-même le débordement du jour, du mois et de l'année. Une heure que
  // le passage à l'heure d'été fait disparaître y devient l'heure équivalente après le saut.
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() + dayOffset,
    hours,
    minutes,
  ).getTime();
}

/** La prochaine occurrence d'une heure `HH:MM`, strictement après l'instant donné. */
export function nextOccurrence(time: string, after: number): number | null {
  const match = TIME.exec(time);
  if (match === null) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const today = localTime(after, 0, hours, minutes);

  return today > after ? today : localTime(after, 1, hours, minutes);
}

/**
 * La plage désignée par deux heures saisies. La fin se résout par rapport au début : une fin
 * antérieure ou égale au début tombe donc le lendemain de celui-ci.
 */
export function resolveWindow(start: string, end: string, now: number): ResolvedWindow | null {
  const startAt = nextOccurrence(start, now);
  if (startAt === null) {
    return null;
  }

  const endAt = nextOccurrence(end, startAt);
  return endAt === null ? null : { startAt, endAt };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** Une borne en clair : l'heure seule aujourd'hui, « demain » le lendemain, le jour au-delà. */
export function formatLocalBound(timestamp: number, now: number): string {
  const bound = new Date(timestamp);
  const today = new Date(now);
  const time = `${twoDigits(bound.getHours())}:${twoDigits(bound.getMinutes())}`;

  if (isSameLocalDay(bound, today)) {
    return time;
  }

  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (isSameLocalDay(bound, tomorrow)) {
    return `demain ${time}`;
  }

  return `le ${twoDigits(bound.getDate())}/${twoDigits(bound.getMonth() + 1)} à ${time}`;
}
