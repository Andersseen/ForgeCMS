import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import unicorn from 'eslint-plugin-unicorn';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.analog/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/drizzle.config.ts',
      '**/drizzle.config.js',
      '**/drizzle.config.d.ts',
      '**/drizzle.config.js.map',
      '**/drizzle.config.d.ts.map'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      import: importPlugin,
      unicorn
    },
    rules: {
      // TypeScript quality
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',

      // Import rules
      'import/no-cycle': 'error',
      'import/no-self-import': 'error',

      // Node.js built-in modules
      'unicorn/prefer-node-protocol': 'error',

      // Code quality
      'unicorn/prefer-modern-math-apis': 'warn',
      'unicorn/prefer-string-starts-ends-with': 'warn',
      'unicorn/no-abusive-eslint-disable': 'warn'
    },
    settings: {
      'import/resolver': {
        typescript: true
      }
    }
  }
);
