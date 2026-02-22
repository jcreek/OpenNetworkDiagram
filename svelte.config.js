import netlifyAdapter from '@sveltejs/adapter-netlify';
import staticAdapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const deployTarget = (process.env.DEPLOY_TARGET ?? 'docker').toLowerCase();
const adapter = deployTarget === 'netlify'
	? netlifyAdapter()
	: staticAdapter({
			fallback: 'index.html',
			strict: false
		});

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter
	}
};

export default config;
