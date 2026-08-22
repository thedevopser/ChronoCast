/**
 * Le canal d'aperçu : le panneau pousse un brouillon de configuration dans l'iframe qu'il encadre.
 *
 * Partagé par les deux pages servies à OBS. Chacune déclare la **forme** qu'elle attend : le
 * panneau envoie toujours une configuration complète, si bien qu'une forme incomplète signale une
 * page qui n'est pas celle qu'on croit — et l'application des variables CSS lèverait en lisant une
 * branche absente.
 */
export const PREVIEW_MESSAGE_TYPE = 'chronocast:overlay-preview';

export interface PreviewSource {
  readonly origin: string;
  readonly data: unknown;
}

export type Shape = Readonly<Record<string, 'string' | 'number' | 'boolean'>>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function matchesShape(value: unknown, shape: Shape): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(shape).every(([key, kind]) => typeof value[key] === kind);
}

export function matchesTree(
  value: unknown,
  root: Shape,
  branches: Readonly<Record<string, Shape>>,
): boolean {
  if (!matchesShape(value, root)) {
    return false;
  }

  return Object.entries(branches).every(([key, shape]) =>
    matchesShape((value as Record<string, unknown>)[key], shape),
  );
}

/** Rend la charge utile d'un message d'aperçu de même origine, ou `null`. */
export function readPreviewEnvelope(
  source: PreviewSource,
  expectedOrigin: string,
): Record<string, unknown> | null {
  if (source.origin !== expectedOrigin) {
    return null;
  }

  const { data } = source;
  return isRecord(data) && data['type'] === PREVIEW_MESSAGE_TYPE ? data : null;
}
