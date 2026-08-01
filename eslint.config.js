import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Configuration ESLint de ChronoCast.
 *
 * Au-delà du style, ce fichier fait respecter mécaniquement trois décisions
 * d'architecture qu'une relecture humaine finirait par laisser passer :
 *
 *   1. l'interdiction absolue des primitives d'injection HTML, parce que
 *      l'overlay affiche des pseudos et des messages choisis par des viewers,
 *      c'est-à-dire du contenu hostile par défaut ;
 *   2. l'étanchéité du noyau, qui ne doit jamais importer `electron` sous peine
 *      de devenir intestable hors d'un environnement Electron ;
 *   3. l'étanchéité du code navigateur, qui ne doit jamais importer une API Node.
 */

/** Primitives d'insertion HTML interdites : toute écriture DOM passe par safe-dom.ts. */
const forbiddenHtmlSinks = [
  {
    selector:
      'MemberExpression[property.name=/^(innerHTML|outerHTML)$/]',
    message:
      "innerHTML et outerHTML sont interdits : un pseudo Twitch est du contenu hostile. Utilisez src/web/shared/safe-dom.ts (textContent).",
  },
  {
    selector: 'CallExpression[callee.property.name="insertAdjacentHTML"]',
    message:
      'insertAdjacentHTML est interdit : il interprète du HTML. Utilisez src/web/shared/safe-dom.ts.',
  },
  {
    selector: 'CallExpression[callee.property.name="write"][callee.object.name="document"]',
    message: 'document.write est interdit.',
  },
];

export default tseslint.config(
  {
    // Artefacts et dépendances : jamais analysés.
    ignores: ['dist/**', 'release/**', 'coverage/**', 'node_modules/**'],
  },

  js.configs.recommended,

  // `strictTypeChecked` exploite les informations de type pour détecter les
  // promesses non attendues, les accès potentiellement `undefined` et les
  // comparaisons impossibles — l'essentiel de la programmation défensive.
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      // Une directive de désactivation devenue inutile est du code mort.
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      /* --- Sécurité : exécution dynamique -------------------------------- */
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-proto': 'error',

      /* --- Sécurité : injection HTML ------------------------------------- */
      'no-restricted-syntax': ['error', ...forbiddenHtmlSinks],

      /* --- Qualité : aucun code mort ------------------------------------- */
      'no-unused-private-class-members': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          // Un paramètre volontairement ignoré se préfixe d'un underscore ;
          // tout le reste est un oubli.
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      /* --- Qualité : gestion exhaustive des erreurs ----------------------- */
      // Une promesse non attendue avale silencieusement ses rejets : c'est la
      // première cause de « l'application s'est arrêtée sans rien dire ».
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      /* --- Qualité : typage honnête -------------------------------------- */
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      // `!` masque une hypothèse non vérifiée : on préfère un contrôle explicite.
      '@typescript-eslint/no-non-null-assertion': 'error',

      /* --- Lisibilité ----------------------------------------------------- */
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-console': 'error',
    },
  },

  {
    /* Le noyau doit rester exécutable dans un Node nu. */
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message:
                "src/core ne doit jamais importer electron : c'est ce qui rend le noyau testable dans un conteneur. Passez par un port de src/core/app/ports.ts.",
            },
          ],
        },
      ],
    },
  },

  {
    /* Le code servi au navigateur ne doit jamais toucher une API serveur. */
    files: ['src/web/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'electron', 'ws', 'fs', 'path', 'crypto'],
              message:
                "Le code navigateur ne peut pas utiliser d'API serveur : il est servi au client, pas exécuté par Node.",
            },
            {
              group: ['**/core/**'],
              // Les types sont effacés à la compilation : les importer ne crée
              // aucun couplage à l'exécution, contrairement à une valeur.
              allowTypeImports: true,
              message:
                'Le code navigateur ne peut importer du noyau que des types (import type).',
            },
          ],
        },
      ],
    },
  },

  {
    /* La coquille Electron a besoin de la console pour les diagnostics de démarrage,
       avant que le système de logs applicatif ne soit initialisé. */
    files: ['src/main/**/*.ts', 'src/headless/**/*.ts', 'scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    /* Les tests manipulent volontairement des cas limites et des valeurs mal formées. */
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      'no-console': 'off',
    },
  },

  {
    /* Scripts d'outillage : JavaScript ES modules exécutés directement par Node,
       hors du programme TypeScript typé. */
    files: ['*.js', '*.mjs', 'scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      // Ces fichiers ne font partie d'aucun programme TypeScript : le service de
      // projet doit être désactivé, sinon le parseur échoue à les résoudre.
      // La fusion explicite est nécessaire car `languageOptions` remplace, et ne
      // complète pas, celui apporté par `disableTypeChecked`.
      ...tseslint.configs.disableTypeChecked.languageOptions,
      parserOptions: {
        projectService: false,
        project: false,
        program: null,
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
);
