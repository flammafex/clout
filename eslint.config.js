import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/vendor/hypertoken/pkg/**', // Generated WASM bindings
    ],
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      // Type safety - warn on any usage to gradually fix
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off', // Too noisy initially
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // Allow unused vars prefixed with underscore
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],

      // Async/await best practices
      '@typescript-eslint/no-floating-promises': 'off', // Enable later
      '@typescript-eslint/require-await': 'warn',

      // Code quality
      'no-console': 'off', // Many legitimate console uses for CLI/server
      'prefer-const': 'warn',
      'no-var': 'error',
      'eqeqeq': ['warn', 'always'],

      // Allow empty catch for specific cases (with comment requirement)
      'no-empty': ['warn', { allowEmptyCatch: false }],

      // Disable rules that conflict with TypeScript
      'no-undef': 'off', // TypeScript handles this
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'warn',
    },
  },
);
