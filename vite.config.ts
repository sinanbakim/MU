import { defineConfig } from 'vite';
import { devvit } from '@devvit/start/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [devvit()],
  build: {
    outDir: 'dist/client',
    rollupOptions: {
      input: {
        game: resolve(__dirname, 'src/client/game.html'),
      },
    },
  },
});
