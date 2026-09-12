import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'global': 'globalThis',
      'process.env': '{}',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'buffer': 'buffer',
        'bigint-buffer': 'bigint-buffer/dist/browser.js',
        'cross-fetch': path.resolve(__dirname, 'src/lib/crossFetchBrowser.js'),
      },
    },
        server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâ€”file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      chunkSizeWarningLimit: 2500,
    }
  };
});
