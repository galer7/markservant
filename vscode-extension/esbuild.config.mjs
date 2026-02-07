import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const isWatch = process.argv.includes('--watch');

// Copy media files to dist
function copyMediaFiles() {
  const mediaDir = join(dirname(new URL(import.meta.url).pathname), 'media');
  const distMediaDir = join(dirname(new URL(import.meta.url).pathname), 'dist', 'media');

  if (!existsSync(distMediaDir)) {
    mkdirSync(distMediaDir, { recursive: true });
  }

  for (const file of ['player.js', 'player.css']) {
    const src = join(mediaDir, file);
    if (existsSync(src)) {
      copyFileSync(src, join(distMediaDir, file));
    }
  }
}

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: false,
  plugins: [
    {
      name: 'copy-media',
      setup(build) {
        build.onEnd(() => {
          copyMediaFiles();
        });
      },
    },
  ],
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(buildOptions);
  console.log('Build complete.');
}
