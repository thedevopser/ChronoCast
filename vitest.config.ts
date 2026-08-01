import { defineConfig } from 'vitest/config';

/**
 * Configuration de la suite de tests.
 *
 * Les tests s'exécutent dans un conteneur Node nu : aucun navigateur, aucun
 * Electron. C'est possible parce que `src/core/**` n'importe jamais `electron`
 * et que toute dépendance système passe par un port injecté.
 *
 * La suite est scindée en deux projets, pour une raison de fond et une seule.
 * Le noyau tourne en `node` : il n'a pas de DOM, et lui en donner un masquerait
 * une API navigateur employée par mégarde dans le backend. Le code de
 * `src/web/**` tourne en `happy-dom`, parce que la propriété qu'on doit y
 * démontrer n'est pas testable autrement : qu'un pseudo Twitch contenant du
 * HTML n'est jamais *interprété*. Un faux `document` écrit à la main prouve
 * qu'on a appelé `textContent` — il ne prouve rien sur le parseur, puisqu'il
 * n'y en a pas. C'est la seule justification de ce second environnement.
 *
 * Elle ne dispense de rien. La logique du front reste extraite dans des modules
 * purs recevant leurs dépendances par injection, exactement comme le noyau ;
 * `happy-dom` ne sert qu'à la frontière où l'on écrit réellement dans le DOM.
 */

/** Cas où l'on doit observer un vrai parseur HTML, et non un objet simulé. */
const WEB_TESTS = ['tests/unit/web/**/*.test.ts', 'tests/security/xss-*.test.ts'];

export default defineConfig({
  test: {
    // Un test qui dépasse cinq secondes signale presque toujours une attente
    // réelle laissée dans le code : on veut le savoir, pas l'ignorer.
    testTimeout: 5_000,
    hookTimeout: 10_000,

    // Isolation : chaque fichier de test s'exécute dans son propre contexte, ce
    // qui empêche une fuite d'état global de rendre un test faussement vert.
    isolate: true,

    // Un test laissant un handle ouvert (serveur, minuteur, socket) doit faire
    // échouer la suite plutôt que de la faire traîner : c'est un défaut réel.
    teardownTimeout: 5_000,

    // La sortie doit rester lisible : un warning non traité est un défaut.
    silent: false,

    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: [
        // Coquille Electron : non exécutable dans un conteneur sans Chromium,
        // vérifiée manuellement sur Windows (voir docs/BUILD.md).
        'src/main/**',
        // Points d'entrée : câblage sans logique propre.
        'src/headless/index.ts',
      ],
    },

    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: WEB_TESTS,
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'happy-dom',
          include: WEB_TESTS,

          // Aucun chargement de ressource. Analyser un gabarit qui référence
          // une feuille de style ferait sinon partir une vraie requête réseau :
          // un test unitaire qui touche le réseau est lent, instable, et son
          // échec ne dit rien de ce qu'il vérifiait.
          //
          // `handleDisabledFileLoadingAsSuccess` est indispensable : sans lui,
          // happy-dom signale chaque chargement refusé comme une erreur, et la
          // sortie se remplit de piles d'appel qui n'annoncent aucun défaut.
          environmentOptions: {
            happyDOM: {
              settings: {
                disableCSSFileLoading: true,
                disableJavaScriptFileLoading: true,
                handleDisabledFileLoadingAsSuccess: true,
              },
            },
          },
        },
      },
    ],
  },
});
