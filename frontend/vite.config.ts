import { defineConfig } from 'vite'

export default defineConfig({
	root: '.',
	publicDir: 'public',
	build: { outDir: 'dist', sourcemap: true },
	server: {
		port: 5173,
		proxy: {
			// Any request to /api/entso gets forwarded to ENTSO-E
			'/api/entso': {
				target: 'https://web-api.tp.entsoe.eu',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/api\/entso/, '/api'),
			},
			// Any request to /api/pse gets forwarded to PSE
			'/api/pse': {
				target: 'https://api.pse.pl',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/api\/pse/, '/v1'),
			},
		},
	},
})