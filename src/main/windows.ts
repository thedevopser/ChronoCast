/**
 * Fenêtre principale de ChronoCast.
 *
 * Elle n'affiche rien d'autre que les pages de notre propre serveur local :
 * le panneau, l'assistant, l'overlay. Le durcissement ci-dessous n'est pas une
 * précaution de principe — cette fenêtre rend du contenu qui incorpore des
 * pseudos et des messages écrits par des viewers, c'est-à-dire par des tiers
 * non fiables.
 *
 * Ce fichier importe `electron` et n'est donc pas exécutable dans le conteneur.
 * Il ne contient pour cette raison **aucune décision** : la seule qui compte,
 * celle de laisser ou non une navigation aboutir, est prise par
 * `navigation-policy.ts`, qui est pur et couvert par `tests/security/`.
 */

import { BrowserWindow, shell } from 'electron';

import { decideNavigation } from './navigation-policy.js';

export interface MainWindowOptions {
  /** Origine du serveur local, port réel compris. */
  readonly appOrigin: string;

  /** Fenêtre masquée au démarrage, selon `app.startMinimized`. */
  readonly startHidden: boolean;

  /** Outils de développement : jamais dans une application packagée. */
  readonly devToolsEnabled: boolean;

  /**
   * Vrai tant que l'application ne se termine pas.
   *
   * Fermer la fenêtre replie vers la zone de notification : le compteur doit
   * survivre à un clic sur la croix comme il survit à un crash. Seul le menu du
   * tray termine réellement l'application, et il fait alors répondre faux à
   * cette fonction pour que la fenêtre se ferme pour de bon.
   */
  hideOnClose(): boolean;

  /** Appelé à la première fermeture, pour prévenir que rien ne s'est arrêté. */
  onFirstHide?: () => void;
}

/** Ouvre une URL dans le navigateur du système, sans jamais faire échouer l'appelant. */
function openExternally(url: string): void {
  // `openExternal` peut échouer — aucun navigateur enregistré, session
  // verrouillée. L'échec ne doit pas remonter dans un gestionnaire d'événement
  // Electron, où il deviendrait une exception non capturée.
  void shell.openExternal(url).catch(() => undefined);
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1_180,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    show: !options.startHidden,
    backgroundColor: '#14131a',
    title: 'ChronoCast',
    autoHideMenuBar: true,
    webPreferences: {
      // Aucun preload : les pages sont servies par le serveur HTTP local et
      // dialoguent avec lui par `fetch` et WebSocket. Un pont vers Node
      // n'aurait aucun usage, et n'existerait donc que comme surface d'attaque.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: options.devToolsEnabled,
    },
  });

  // Une page qui demande une nouvelle fenêtre ne l'obtient jamais. Si sa cible
  // est Twitch, elle part dans le navigateur du système ; sinon rien ne se
  // passe. ChronoCast n'a qu'une fenêtre, et c'est celle-ci.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (decideNavigation(url, { appOrigin: options.appOrigin }) === 'external') {
      openExternally(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    const decision = decideNavigation(url, { appOrigin: options.appOrigin });
    if (decision === 'allow') {
      return;
    }

    event.preventDefault();
    if (decision === 'external') {
      openExternally(url);
    }
  });

  let hiddenOnce = false;

  window.on('close', (event) => {
    if (!options.hideOnClose()) {
      return;
    }

    event.preventDefault();
    window.hide();

    if (!hiddenOnce) {
      hiddenOnce = true;
      options.onFirstHide?.();
    }
  });

  // La racine redirige d'elle-même vers l'assistant ou le panneau selon
  // `setup.completed` : la fenêtre n'a pas à savoir lequel des deux montrer.
  void window.loadURL(`${options.appOrigin}/`);

  return window;
}
