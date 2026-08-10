export interface ParsedCommand {
  readonly name: string;

  readonly argument: string | null;
}

const PREFIX = '!';

const INVISIBLE_SUFFIX = /\u{E0000}/gu;

export function parseCommand(text: string): ParsedCommand | null {
  if (typeof text !== 'string') {
    return null;
  }

  const cleaned = text.replace(INVISIBLE_SUFFIX, '').trim();
  if (!cleaned.startsWith(PREFIX)) {
    return null;
  }

  const rest = cleaned.slice(PREFIX.length);
  if (rest === '' || /^\s/u.test(rest)) {
    return null;
  }

  const [name, argument] = rest.split(/\s+/u);
  if (name === undefined || name === '') {
    return null;
  }

  return { name: name.toLowerCase(), argument: argument ?? null };
}
