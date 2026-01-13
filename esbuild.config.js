const esbuild = require('esbuild')
const packageJson = require('./package.json')

console.log(`building ${packageJson.name}`)

// Inlined from shared esbuild.config.base.js
function createConfig(opts = {}) {
  const prod = process.env.NODE_ENV === 'production'
  const define =
    opts.format === 'esm'
      ? {
          ...opts.define,
          __dirname: 'import.meta.dirname',
        }
      : {
          ...opts.define,
        }
  return {
    bundle: true,
    platform: opts.platform || 'node',
    target: 'es2020',
    sourcemap: !prod,
    minify: false,
    external: [],
    loader: {
      '.ts': 'ts',
      '.tsx': 'tsx',
      '.css': 'css',
    },
    ...opts,
    define,
  }
}

function build(config) {
  esbuild.build(config).catch(() => process.exit(1))
}

const EXTERNAL_BASE = [
  'node:crypto',
  'node:events',
  'node:fs',
  'node:module',
  'node:os',
  'node:path',
  'node:stream',
  'node:stream/promises',
  'electron',
  'debug',
]

const external = [...EXTERNAL_BASE, 'electron-chrome-extensions/preload']

const browserConfig = createConfig({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/cjs/index.js',
  platform: 'node',
  external,
})

const browserESMConfig = createConfig({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/esm/index.mjs',
  platform: 'node',
  external,
  format: 'esm',
})

build(browserConfig)
build(browserESMConfig)

const preloadConfig = createConfig({
  entryPoints: ['src/preload.ts'],
  outfile: 'dist/chrome-extension-api.preload.js',
  platform: 'browser',
  external,
  sourcemap: false,
})

build(preloadConfig)

const browserActionPreloadConfig = createConfig({
  entryPoints: ['src/browser-action.ts'],
  outfile: 'dist/cjs/browser-action.js',
  platform: 'browser',
  format: 'cjs',
  external,
  sourcemap: false,
})

const browserActionESMPreloadConfig = createConfig({
  entryPoints: ['src/browser-action.ts'],
  outfile: 'dist/esm/browser-action.mjs',
  platform: 'browser',
  external,
  sourcemap: false,
  format: 'esm',
})

build(browserActionPreloadConfig)
build(browserActionESMPreloadConfig)
