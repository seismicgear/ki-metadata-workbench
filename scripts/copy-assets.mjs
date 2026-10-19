import { cp, mkdir, writeFile } from 'node:fs/promises';
await mkdir('dist/renderer', {recursive: true});
await cp('src/renderer/index.html', 'dist/renderer/index.html');
await cp('src/renderer/app.css', 'dist/renderer/app.css');
await cp('assets', 'dist/assets', {recursive: true});
// ESM marker lets the dependency-free model tests import compiled UI modules.
await writeFile('dist/package.json', JSON.stringify({type: 'module'}));
