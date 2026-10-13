export interface TimeFormatOptions {
  readonly showDays: boolean;
  readonly hideEmptyHours: boolean;
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_DAY = 86_400;

function pad(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value);
}

function wholeSecondsLeft(remainingMs: number): number {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return 0;
  }
  return Math.floor(remainingMs / 1_000);
}

export function formatRemaining(remainingMs: number, options: TimeFormatOptions): string {
  const total = wholeSecondsLeft(remainingMs);

  const days = options.showDays ? Math.floor(total / SECONDS_PER_DAY) : 0;
  const rest = total - days * SECONDS_PER_DAY;

  const hours = Math.floor(rest / SECONDS_PER_HOUR);
  const minutes = Math.floor((rest % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = rest % SECONDS_PER_MINUTE;

  if (options.hideEmptyHours && days === 0 && hours === 0) {
    return `${pad(minutes)}:${pad(seconds)}`;
  }

  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${String(days)}j ${clock}` : clock;
}

const TENTHS_PER_SECOND = 10;

export function formatReward(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return '+0 s';
  }

  const sign = seconds < 0 ? '-' : '+';
  const magnitude = Math.abs(seconds);

  // En deçà de la minute, un crédit garde une décimale : un bit peut valoir moins d'une seconde,
  // et « +0 s » dirait qu'il n'a rien valu.
  const tenths = Math.max(Math.round(magnitude * TENTHS_PER_SECOND), magnitude > 0 ? 1 : 0);
  if (tenths < SECONDS_PER_MINUTE * TENTHS_PER_SECOND) {
    const whole = Math.floor(tenths / TENTHS_PER_SECOND);
    const tenth = tenths % TENTHS_PER_SECOND;
    return tenth === 0
      ? `${sign}${String(whole)} s`
      : `${sign}${String(whole)},${String(tenth)} s`;
  }

  const total = Math.max(Math.trunc(magnitude), SECONDS_PER_MINUTE);

  if (total < SECONDS_PER_HOUR) {
    const minutes = Math.floor(total / SECONDS_PER_MINUTE);
    const rest = total % SECONDS_PER_MINUTE;
    return rest === 0
      ? `${sign}${String(minutes)} min`
      : `${sign}${String(minutes)} min ${pad(rest)}`;
  }

  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return minutes === 0 ? `${sign}${String(hours)} h` : `${sign}${String(hours)} h ${pad(minutes)}`;
}
