/**
 * Audit du gabarit du panneau d'administration.
 *
 * Le panneau est la page la plus exposée des trois. Il porte le jeton, il
 * commande le compteur, et il **affiche du contenu contrôlé par des tiers** :
 * pseudos, motifs, messages de journal. Il cumule donc les risques de
 * l'assistant et ceux de l'overlay.
 *
 * Ce fichier ne vérifie que ce qui se lit dans le gabarit — la structure et sa
 * conformité à la CSP. Ce qui s'y écrit à l'exécution relève de `safe-dom`,
 * couvert pour lui-même, et des tests d'injection des lots suivants.
 *
 * Deux marqueurs, deux régimes, et c'est le cœur du sujet ici : le jeton CSRF
 * **doit** être présent, comme dans l'assistant et à l'inverse de l'overlay ;
 * le port du WebSocket **doit** l'être aussi, mais lui sur les trois pages —
 * ce n'est pas un secret.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ADMIN_VIEWS } from '../../src/web/admin/router.js';

const ADMIN_HTML = readFileSync(resolve(process.cwd(), 'src/web/admin/index.html'), 'utf8');
const parsed = new DOMParser().parseFromString(ADMIN_HTML, 'text/html');

describe('marqueurs substitués par le serveur', () => {
  it('porte le marqueur du jeton CSRF', () => {
    // Sans lui, toute mutation répond `403` — et le serveur refuse **avant**
    // de résoudre la route, si bien que rien n'indiquerait la cause.
    const meta = parsed.querySelector('meta[name="chronocast-csrf"]');

    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toBe('__CHRONOCAST_CSRF__');
  });

  it('porte le marqueur du port WebSocket', () => {
    const meta = parsed.querySelector('meta[name="chronocast-ws-port"]');

    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toBe('__CHRONOCAST_WS_PORT__');
  });
});

describe('navigation', () => {
  it('déclare une section par vue connue du routeur', () => {
    // Une entrée de navigation qui mène à une section absente ferait lever
    // `requireElement` au premier clic, et le panneau resterait figé.
    for (const view of ADMIN_VIEWS) {
      expect(parsed.querySelector(`#view-${view}`)).not.toBeNull();
    }
  });

  it('ne déclare aucune section hors de la liste close', () => {
    const declared = [...parsed.querySelectorAll('[id^="view-"]')].map((element) =>
      element.id.replace(/^view-/, ''),
    );

    expect(declared.sort()).toEqual([...ADMIN_VIEWS].sort());
  });

  it('ne code en dur aucun lien vers une vue', () => {
    // La navigation est construite à l'exécution depuis la liste close de
    // `router.ts` : c'est une garantie plus forte qu'un audit statique, mais
    // elle ne tient que si le gabarit ne double pas ces liens à la main.
    const targets = [...parsed.querySelectorAll('a[href^="#"]')].map((element) =>
      (element.getAttribute('href') ?? '').replace(/^#/, ''),
    );

    for (const target of targets) {
      expect(ADMIN_VIEWS).toContain(target);
    }
  });

  it('réserve au câblage le point d’ancrage de la navigation', () => {
    expect(parsed.querySelector('#nav')?.children).toHaveLength(0);
  });
});

describe('conformité à la CSP', () => {
  it('ne contient aucun script en ligne', () => {
    const inline = [...parsed.querySelectorAll('script')].filter(
      (element) => !element.hasAttribute('src'),
    );

    expect(inline).toHaveLength(0);
  });

  it('ne contient aucun style en ligne', () => {
    // `style-src 'self'` interdit la balise **et** l'attribut. Les variables
    // d'apparence passent par le CSSOM, qui n'est pas couvert par la CSP.
    expect(parsed.querySelectorAll('style')).toHaveLength(0);
    expect(parsed.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('ne contient aucun gestionnaire d’événement en attribut', () => {
    const withHandlers = [...parsed.querySelectorAll('*')].filter((element) =>
      [...element.attributes].some((attribute) => attribute.name.startsWith('on')),
    );

    expect(withHandlers).toHaveLength(0);
  });

  it('ne contient aucun formulaire soumissible', () => {
    // `form-action 'none'` : une soumission serait bloquée sans un mot
    // d'explication, et l'utilisateur croirait avoir enregistré ses réglages.
    expect(parsed.querySelectorAll('form')).toHaveLength(0);
  });

  it('ne déclare que des boutons inertes', () => {
    const untyped = [...parsed.querySelectorAll('button')].filter(
      (element) => element.getAttribute('type') !== 'button',
    );

    expect(untyped).toHaveLength(0);
  });
});

describe('ressources', () => {
  it('ne charge aucun script ni aucune feuille distante', () => {
    const sources = [...parsed.querySelectorAll('script[src], link[href]')].map(
      (element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '',
    );

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.startsWith('/')).toBe(true);
    }
  });

  it('charge les primitives avant les tokens, et les tokens avant la page', () => {
    // L'ordre n'est pas cosmétique : `theme.css` référence les primitives
    // d'Open Props, et `admin.css` ne connaît que les tokens de `theme.css`.
    const sheets = [...parsed.querySelectorAll('link[rel="stylesheet"]')].map(
      (element) => element.getAttribute('href') ?? '',
    );

    expect(sheets.indexOf('/shared/open-props.css')).toBeLessThan(
      sheets.indexOf('/shared/theme.css'),
    );
    expect(sheets.indexOf('/shared/theme.css')).toBeLessThan(sheets.indexOf('/admin/admin.css'));
  });

  it('charge son module par chemin absolu', () => {
    // La page est servie à /admin, sans barre oblique finale : un chemin
    // relatif se résoudrait à la racine du site.
    const script = parsed.querySelector('script[type="module"]');

    expect(script?.getAttribute('src')).toBe('/admin/main.js');
  });

  it('neutralise les liens sortants', () => {
    const external = [...parsed.querySelectorAll('a[href]')].filter((element) =>
      (element.getAttribute('href') ?? '').startsWith('http'),
    );

    for (const link of external) {
      expect(link.getAttribute('rel')).toContain('noreferrer');
      expect(link.getAttribute('href')?.startsWith('https://')).toBe(true);
    }
  });
});

describe('renvoi vers les paramètres de Windows', () => {
  it('offre un bouton inerte, câblé par `main.ts`', () => {
    // Le lancement à l'ouverture de session n'est plus un réglage de
    // ChronoCast : sous MSIX, `setLoginItemSettings` écrit dans un registre
    // virtualisé, et la case aurait coché sans que rien ne démarre. Le panneau
    // n'a plus qu'à mener là où Windows détient l'état.
    const button = parsed.querySelector('#open-startup-settings');

    expect(button).not.toBeNull();
    // `type="button"` comme partout ailleurs : la CSP interdit `form-action`,
    // et un bouton par défaut soumettrait.
    expect(button?.getAttribute('type')).toBe('button');
  });

  it('ne code en dur aucune adresse `ms-settings:`', () => {
    // L'adresse est une constante de la coquille, jamais une valeur qui
    // voyage. L'écrire dans la page en ferait un paramètre, c'est-à-dire une
    // capacité d'ouvrir n'importe quel schéma.
    expect(ADMIN_HTML).not.toContain('ms-settings:');
  });
});
