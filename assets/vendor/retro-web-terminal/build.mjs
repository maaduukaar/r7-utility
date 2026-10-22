import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
await build({
    absWorkingDir: root,
    entryPoints: ['adapter.ts'],
    outfile: '../../retro-terminal/terminal.js',
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify: true,
    legalComments: 'eof',
    loader: { '.woff2': 'file', '.woff': 'file' },
    assetNames: 'fonts/[name]-[hash]',
    banner: { js: '/* Retro Web Terminal (MIT), Travis Fischer. See LICENSES.txt. */' }
});

const licenses = [
    ['Retro Web Terminal', '../../retro-web-terminal-LICENSE.txt'],
    ['xterm.js', 'node_modules/@xterm/xterm/LICENSE'],
    ['xterm Fit addon', 'node_modules/@xterm/addon-fit/LICENSE'],
    ['xterm WebGL addon', 'node_modules/@xterm/addon-webgl/LICENSE'],
    ['IBM Plex Mono', 'node_modules/@fontsource/ibm-plex-mono/LICENSE']
];
const notices = await Promise.all(licenses.map(async ([name, path]) =>
    `${name}\n${await readFile(new URL(path, import.meta.url), 'utf8')}\n`
));
await writeFile(new URL('../../retro-terminal/LICENSES.txt', import.meta.url), notices.join('\n'));
