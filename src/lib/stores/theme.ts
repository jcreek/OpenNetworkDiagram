import { writable } from 'svelte/store';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'ond-theme';

function getInitialTheme(): ThemeMode {
	if (typeof window === 'undefined') {
		return 'light';
	}
	const stored = window.localStorage.getItem(STORAGE_KEY);
	if (stored === 'light' || stored === 'dark') {
		return stored;
	}
	return 'light';
}

function applyTheme(theme: ThemeMode) {
	if (typeof document === 'undefined') {
		return;
	}
	document.documentElement.setAttribute('data-theme', theme);
}

function createThemeStore() {
	const store = writable<ThemeMode>('light');

	return {
		subscribe: store.subscribe,
		initialize() {
			const theme = getInitialTheme();
			store.set(theme);
			applyTheme(theme);
		},
		toggle() {
			store.update((current) => {
				const next = current === 'dark' ? 'light' : 'dark';
				if (typeof window !== 'undefined') {
					window.localStorage.setItem(STORAGE_KEY, next);
				}
				applyTheme(next);
				return next;
			});
		},
		set(theme: ThemeMode) {
			if (typeof window !== 'undefined') {
				window.localStorage.setItem(STORAGE_KEY, theme);
			}
			applyTheme(theme);
			store.set(theme);
		}
	};
}

export const themeMode = createThemeStore();
