import { resolve } from 'node:path';

import { createApplication, type Application } from '../core/app/application.js';
import { createFsPathProvider, defaultWebRoot } from '../core/app/fs-path-provider.js';
import { createNodeRuntime } from '../core/app/node-runtime.js';
import type { BrowserOpener } from '../core/app/ports.js';
import { createSystemClock } from '../core/app/system-clock.js';
import { APP_VERSION } from '../core/app/version.js';
import { createSystemTicker } from '../core/app/system-ticker.js';
import { createLogger } from '../core/logging/logger.js';
import { createConsoleSink } from '../core/logging/sinks/console-sink.js';
import { createAesSecretStore } from './aes-secret-store.js';

function createConsoleBrowserOpener(): BrowserOpener {
  return {
    open(url: string): Promise<void> {
      if (!url.startsWith('https://')) {
        return Promise.reject(new Error('seules les URL https peuvent être ouvertes'));
      }
      console.log(`\nOuvrez cette adresse dans votre navigateur :\n${url}\n`);
      return Promise.resolve();
    },
  };
}

export function buildHeadlessApplication(): Application {
  const paths = createFsPathProvider({ webRootDirectory: defaultWebRoot(import.meta.url) });

  const logger = createLogger({ level: 'info', sinks: [createConsoleSink()] });

  return createApplication({
    paths,
    secrets: createAesSecretStore({ directory: paths.dataDirectory, logger }),
    clock: createSystemClock(),
    browser: createConsoleBrowserOpener(),
    ticker: createSystemTicker(),
    appVersion: APP_VERSION,
    ...createNodeRuntime(),
  });
}

async function main(): Promise<void> {
  const application = buildHeadlessApplication();
  const port = await application.start();

  console.log(
    [
      '',
      'ChronoCast est démarré.',
      `  Panneau d'administration : http://127.0.0.1:${String(port)}/admin`,
      `  Overlay à coller dans OBS : http://127.0.0.1:${String(port)}/overlay`,
      '',
    ].join('\n'),
  );

  let stopping = false;

  const shutdown = (signal: string): void => {
    if (stopping) {
      return;
    }
    stopping = true;

    console.log(`\nArrêt demandé (${signal})…`);

    application.stop().then(
      () => {
        process.exit(0);
      },
      (error: unknown) => {
          console.error('arrêt incomplet :', error);
        process.exit(1);
      },
    );
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
}

if (process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`) {
  main().catch((error: unknown) => {
    console.error('démarrage impossible :', error);
    process.exit(1);
  });
}
