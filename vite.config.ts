import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const staticDemoMode = process.env.OND_STATIC_DEMO === 'true';

export default defineConfig({
	define: {
		'import.meta.env.OND_STATIC_DEMO': JSON.stringify(staticDemoMode)
	},
	plugins: [tailwindcss(), sveltekit()]
});
