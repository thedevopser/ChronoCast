import { defineConfig } from 'vitest/config';

/**
 * Configuration de la suite de tests.
 *
 * Les tests s'exécutent dans un conteneur Node nu : aucun navigateur, aucun
 * Electron. C'est possible parce que `src/core/**` n'importe jamais `electron`
 * et que toute dépendance système passe par un port injecté.
 */
export default defineConfig({
  test: {
    // `node` et non `jsdom` : les modules destinés au navigateur sont conçus pour
    // recevoir leurs dépendances (WebSocket, document) par injection, ce qui les
    // rend testables sans simuler un DOM complet.
    environment: 'node',

    include: ['tests/**/*.test.ts'],

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
  },
});
