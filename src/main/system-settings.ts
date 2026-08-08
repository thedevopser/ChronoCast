import type { SystemSettingsOpener } from '../core/app/ports.js';

export const STARTUP_SETTINGS_URI = 'ms-settings:startupapps';

export interface SystemSettingsOpenerOptions {
  openExternal(url: string): Promise<void>;
}

export function createSystemSettingsOpener(
  options: SystemSettingsOpenerOptions,
): SystemSettingsOpener {
  return {
    openStartupSettings(): Promise<void> {
      return options.openExternal(STARTUP_SETTINGS_URI);
    },
  };
}
