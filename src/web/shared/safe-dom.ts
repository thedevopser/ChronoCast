export const MAX_TEXT_LENGTH = 64;

const UNSAFE_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200b],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

function isUnsafe(codePoint: number): boolean {
  return UNSAFE_RANGES.some(([from, to]) => codePoint >= from && codePoint <= to);
}

const ELLIPSIS = '…';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(value: string): string[] {
  return [...segmenter.segment(value)].map((entry) => entry.segment);
}

export function sanitizeText(value: string, maxLength: number): string {
  let cleaned = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && !isUnsafe(codePoint)) {
      cleaned += character;
    }
  }

  const units = graphemes(cleaned);
  if (units.length <= maxLength) {
    return cleaned;
  }

  return units.slice(0, maxLength - 1).join('') + ELLIPSIS;
}

export function setText(target: Element, value: string, maxLength = MAX_TEXT_LENGTH): void {
  target.textContent = sanitizeText(value, maxLength);
}

export function clearChildren(target: Element): void {
  target.replaceChildren();
}

export function requireElement(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error(`élément introuvable dans le gabarit : ${selector}`);
  }
  return element;
}

export function setCssVariables(
  target: ElementCSSInlineStyle,
  variables: Readonly<Record<string, string>>,
): void {
  for (const [name, value] of Object.entries(variables)) {
    if (!name.startsWith('--')) {
      throw new Error(`nom de variable CSS attendu, reçu : ${name}`);
    }
    target.style.setProperty(name, value);
  }
}
