/**
 * Injection de contenu hostile dans l'overlay.
 *
 * C'est le scénario d'attaque le plus concret de tout ChronoCast, et le seul
 * qui ne demande aucun accès privilégié : **n'importe quel spectateur choisit
 * son pseudonyme**. Il lui suffit de s'abonner à la chaîne pour que ce
 * pseudonyme traverse EventSub, le noyau, le WebSocket, et finisse affiché dans
 * une Browser Source OBS qui tourne sur la machine du streamer, sans
 * surveillance, pendant des heures.
 *
 * Deux garanties sont vérifiées ici, de natures différentes.
 *
 * **Le contenu n'est jamais interprété.** Une batterie de charges utiles réelles
 * est écrite dans un vrai arbre DOM ; on constate qu'aucun élément n'en naît.
 * Le test tourne sous `happy-dom` précisément pour cela : un faux `document`
 * dirait seulement qu'on a appelé `textContent`, pas ce qu'un analyseur HTML
 * fait de la chaîne.
 *
 * **Le gabarit lui-même est sain.** La CSP servie par ChronoCast bloquerait un
 * script en ligne, mais silencieusement : la page fonctionnerait mal sans que
 * personne ne comprenne pourquoi. Autant refuser le gabarit à la compilation
 * plutôt que de le découvrir en direct. On vérifie aussi que l'overlay ne porte
 * pas le marqueur de jeton CSRF — il ne mute rien, il n'a aucune raison de
 * détenir un secret que n'importe quelle scène OBS exposerait.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { sanitizeText, setText } from '../../src/web/shared/safe-dom.js';

// Chemin depuis la racine du projet, et non depuis `import.meta.url` : sous
// `happy-dom`, celui-ci porte le schéma du document simulé et non `file:`.
const OVERLAY_HTML = readFileSync(
  resolve(process.cwd(), 'src/web/overlay/index.html'),
  'utf8',
);

/**
 * Charges utiles réelles, telles qu'un spectateur peut les saisir.
 *
 * Twitch impose un pseudonyme alphanumérique, mais `channel.chat.notification`
 * expose aussi le **nom affiché**, bien plus permissif, et un message de cheer
 * est du texte libre. On ne fait donc aucune hypothèse sur ce qui arrive.
 */
const HOSTILE_PAYLOADS: readonly string[] = [
  '<img src=x onerror=alert(1)>',
  '<script>alert(document.cookie)</' + 'script>',
  '<svg onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '"><script>alert(1)</' + 'script>',
  "'><img src=x onerror=alert(1)>",
  '<body onload=alert(1)>',
  '<a href="javascript:alert(1)">clic</a>',
  '<style>*{display:none}</' + 'style>',
  '<link rel=stylesheet href="http://exemple.invalide/a.css">',
  '<object data="data:text/html,<script>alert(1)</' + 'script>"></object>',
  '&lt;img src=x onerror=alert(1)&gt;',
  '<<SCRIPT>alert(1);//<</SCRIPT>',
];

describe('pseudonyme hostile écrit dans l’overlay', () => {
  it.each(HOSTILE_PAYLOADS)('ne crée aucun élément à partir de %j', (payload) => {
    const target = document.createElement('div');

    setText(target, payload);

    expect(target.children).toHaveLength(0);
    expect(target.querySelectorAll('*')).toHaveLength(0);
  });

  it.each(HOSTILE_PAYLOADS)('n’ajoute qu’un nœud de texte pour %j', (payload) => {
    const target = document.createElement('div');

    setText(target, payload);

    expect(target.childNodes).toHaveLength(1);
    expect(target.childNodes[0]?.nodeType).toBe(3 /* Node.TEXT_NODE */);
  });

  it('ne laisse aucun script apparaître dans le document', () => {
    const target = document.createElement('div');
    document.body.append(target);

    for (const payload of HOSTILE_PAYLOADS) {
      setText(target, payload);
    }

    expect(document.querySelectorAll('script')).toHaveLength(0);
    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect(document.querySelectorAll('iframe')).toHaveLength(0);

    target.remove();
  });

  it('borne la longueur affichée quelle que soit la charge utile', () => {
    // Un pseudonyme de dix mille caractères ne doit pas pousser le compteur
    // hors de l'écran ni faire ramer la composition d'OBS.
    const target = document.createElement('div');

    setText(target, '<img src=x onerror=alert(1)>'.repeat(1_000));

    expect(sanitizeText(target.textContent ?? '', 64)).toBe(target.textContent);
    expect((target.textContent ?? '').length).toBeLessThanOrEqual(65);
  });
});

describe('gabarit de l’overlay', () => {
  const parsed = new DOMParser().parseFromString(OVERLAY_HTML, 'text/html');

  it('ne porte pas le marqueur de jeton CSRF', () => {
    // `routes/pages.ts` ne substitue le marqueur que sur /admin et /setup.
    // S'il apparaissait ici, il serait servi tel quel — et une page qui affiche
    // « __CHRONOCAST_CSRF__ » à l'écran est le moindre des soucis.
    expect(OVERLAY_HTML).not.toContain('__CHRONOCAST_CSRF__');
    expect(parsed.querySelector('meta[name="chronocast-csrf"]')).toBeNull();
  });

  it('ne contient aucun script en ligne', () => {
    // `script-src 'self'` sans `unsafe-inline` : un script en ligne serait
    // bloqué silencieusement, et l'overlay resterait figé sans explication.
    const inlineScripts = [...parsed.querySelectorAll('script')].filter(
      (element) => !element.hasAttribute('src'),
    );

    expect(inlineScripts).toHaveLength(0);
  });

  it('ne contient aucun style en ligne', () => {
    // Même raison, avec `style-src 'self'`.
    expect(parsed.querySelectorAll('style')).toHaveLength(0);
    expect(parsed.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('ne contient aucun gestionnaire d’événement en attribut', () => {
    const withHandlers = [...parsed.querySelectorAll('*')].filter((element) =>
      [...element.attributes].some((attribute) => attribute.name.startsWith('on')),
    );

    expect(withHandlers).toHaveLength(0);
  });

  it('ne référence aucune ressource distante', () => {
    // L'application doit fonctionner hors ligne, et la CSP n'autorise que
    // `'self'`. Une police sur un CDN laisserait l'overlay vide au démarrage
    // de la scène, le temps d'un délai d'attente réseau.
    const references = [...parsed.querySelectorAll('[src], [href]')].map(
      (element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '',
    );

    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(reference.startsWith('/')).toBe(true);
    }
  });
});
