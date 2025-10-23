import esbuild from 'esbuild';

const prod = process.argv.includes('--production');

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: 'dist/extension.js',
  sourcemap: !prod,
  minify: prod,
  external: ['vscode', 'mocha'],
  logLevel: 'info'
});
