import type { BrowserOpener } from '../core/app/ports.js';

export interface ExternalBrowserOpenerOptions {
  openExternal(url: string): Promise<void>;
}

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function createExternalBrowserOpener(
  options: ExternalBrowserOpenerOptions,
): BrowserOpener {
  return {
    open(url: string): Promise<void> {
      if (!isHttps(url)) {
        return Promise.reject(new Error('seules les URL https peuvent être ouvertes'));
      }

      return options.openExternal(url);
    },
  };
}
