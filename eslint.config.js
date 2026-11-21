import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/coverage/**', '**/dist/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },
  {
    // The page runs in a browser: a value imported from core's index pulls Node
    // code into its bundle and stops the page at load, which no other check sees.
    // A single core file with no Node in it may still be imported by its path.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@jgtube/core',
              allowTypeImports: true,
              message:
                'Import only types from @jgtube/core in the page, or import a single core file by its path.',
            },
          ],
        },
      ],
    },
  },
);
