export interface PathProvider {
  readonly dataDirectory: string;

  readonly logsDirectory: string;

  readonly historyDirectory: string;

  readonly webRootDirectory: string;

  resolveDataFile(...segments: string[]): string;
}

export interface SecretStore {
  isEncryptionAvailable(): boolean;

  read(key: string): Promise<string | null>;

  write(key: string, value: string): Promise<void>;

  delete(key: string): Promise<void>;
}

export interface Clock {
  now(): number;

  monotonicMs(): number;
}

export interface BrowserOpener {
  open(url: string): Promise<void>;
}

export interface SystemSettingsOpener {
  openStartupSettings(): Promise<void>;
}
