/**
 * Résolution de l'URL du WebSocket.
 *
 * Le sujet paraît anodin et ne l'est pas. En mode `shared` — le défaut acté —
 * le socket vit sur le port HTTP, et `window.location.host` suffit. En mode
 * `separate`, il écoute ailleurs, et la page doit connaître ce port **avant**
 * d'ouvrir la connexion : le `hello` qui le transporte arrive sur le socket
 * qu'il aurait fallu savoir joindre.
 *
 * D'où le marqueur substitué dans le HTML, sur le modèle du jeton CSRF. Ce
 * module en est la lecture et la mise en forme ; ce sont deux endroits où une
 * erreur ne se voit qu'à l'exécution, dans une Browser Source OBS qui n'a
 * aucun lecteur.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { readWebSocketPort, resolveWebSocketUrl, WS_PORT_META } from '../../../../src/web/shared/ws-url.js';

/** Pose un méta dans le document courant, comme le ferait `routes/pages.ts`. */
function putMeta(content: string): void {
  const meta = document.createElement('meta');
  meta.setAttribute('name', WS_PORT_META);
  meta.setAttribute('content', content);
  document.head.append(meta);
}

beforeEach(() => {
  document.head.replaceChildren();
});

describe('readWebSocketPort', () => {
  it('lit le port substitué dans le gabarit', () => {
    putMeta('3778');
    expect(readWebSocketPort(document)).toBe(3778);
  });

  it('renvoie null quand le méta est absent', () => {
    // L'overlay peut avoir été servi par une version antérieure, ou la page
    // ouverte depuis un fichier : le repli sur l'hôte courant doit marcher.
    expect(readWebSocketPort(document)).toBeNull();
  });

  it('renvoie null quand le marqueur n’a pas été substitué', () => {
    putMeta('__CHRONOCAST_WS_PORT__');
    expect(readWebSocketPort(document)).toBeNull();
  });

  it.each(['0', '65536', '-1', '3778.5', 'abcd', '', '  '])(
    'renvoie null pour un port aberrant : %o',
    (raw) => {
      putMeta(raw);
      expect(readWebSocketPort(document)).toBeNull();
    },
  );

  it('ignore un port porteur de caractères d’URL', () => {
    // Le méta est écrit par le serveur, mais un repli silencieux vaut mieux
    // qu'une URL fabriquée à partir d'une valeur inattendue.
    putMeta('3778/../evil');
    expect(readWebSocketPort(document)).toBeNull();
  });
});

describe('resolveWebSocketUrl', () => {
  it('reste sur l’hôte courant quand aucun port n’est connu', () => {
    expect(
      resolveWebSocketUrl({ host: '127.0.0.1:3777', protocol: 'http:', port: null }),
    ).toBe('ws://127.0.0.1:3777/ws');
  });

  it('reste sur l’hôte courant quand le port annoncé est celui de la page', () => {
    // Mode `shared` : réécrire l'hôte ne changerait rien, autant ne pas le faire.
    expect(
      resolveWebSocketUrl({ host: '127.0.0.1:3777', protocol: 'http:', port: 3777 }),
    ).toBe('ws://127.0.0.1:3777/ws');
  });

  it('bascule sur le port annoncé en mode separate', () => {
    expect(
      resolveWebSocketUrl({ host: '127.0.0.1:3777', protocol: 'http:', port: 3778 }),
    ).toBe('ws://127.0.0.1:3778/ws');
  });

  it('conserve le nom d’hôte quand la page n’expose aucun port', () => {
    expect(resolveWebSocketUrl({ host: 'localhost', protocol: 'http:', port: 3778 })).toBe(
      'ws://localhost:3778/ws',
    );
  });

  it('préserve les crochets d’une adresse IPv6', () => {
    expect(resolveWebSocketUrl({ host: '[::1]:3777', protocol: 'http:', port: 3778 })).toBe(
      'ws://[::1]:3778/ws',
    );
  });

  it('passe en wss quand la page est servie en https', () => {
    // Le serveur local est en clair, mais la règle est écrite une fois pour
    // toutes : une page en https ne peut pas ouvrir un socket en clair.
    expect(resolveWebSocketUrl({ host: '127.0.0.1:3777', protocol: 'https:', port: null })).toBe(
      'wss://127.0.0.1:3777/ws',
    );
  });

  it('accepte un chemin explicite', () => {
    expect(
      resolveWebSocketUrl({ host: '127.0.0.1:3777', protocol: 'http:', port: null, path: '/socket' }),
    ).toBe('ws://127.0.0.1:3777/socket');
  });
});
