import { includeIgnoreFile } from '@eslint/compat';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));
const baseDirectory = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({
	baseDirectory,
	recommendedConfig: js.configs.recommended
});

const airbnbBaseConfig = compat.extends('airbnb-base').map((config) => ({
	...config,
	files: ['**/*.{js,cjs,mjs,ts,cts,mts}']
}));

export default tseslint.config(
	includeIgnoreFile(gitignorePath),
	{
		ignores: ['eslint.config.js', 'svelte.config.js', 'vite.config.ts']
	},
	{
		plugins: {
			import: importPlugin
		}
	},
	...airbnbBaseConfig,
	...tseslint.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		},
		settings: {
			'import/resolver': {
				node: {
					extensions: ['.js', '.mjs', '.cjs', '.ts', '.d.ts', '.svelte', '.json']
				}
			},
			'import/extensions': ['.js', '.ts', '.mjs', '.svelte']
		},
		rules: {
			curly: ['error', 'all'],
			'brace-style': ['error', '1tbs', { allowSingleLine: false }],
			'no-continue': 'off',
			'no-restricted-syntax': 'off',
			'no-inner-declarations': 'off',
			'no-unused-vars': 'off',
			'import/no-extraneous-dependencies': 'off',
			'import/no-unresolved': 'off',
			'import/prefer-default-export': 'off',
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
			'import/extensions': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: tseslint.parser,
				svelteConfig
			}
		},
		rules: {
			// Svelte components commonly export mutable props and top-level declarations.
			'import/prefer-default-export': 'off',
			'import/no-mutable-exports': 'off'
		}
	}
);
