import { DiscordProxy } from '@robojs/patch'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react(), DiscordProxy.Vite(), tailwindcss()],
  resolve: {
		alias: {
			'@': resolve(__dirname, '../src')
		}
	},
	server: {
		allowedHosts: true
	}
})
