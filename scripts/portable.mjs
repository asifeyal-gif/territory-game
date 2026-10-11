import { readFile, writeFile } from 'node:fs/promises';

// The game has no external assets. Inline the production bundle for offline file:// play.
let html = await readFile('dist/index.html', 'utf8');
const script = html.match(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/);
const style = html.match(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/);
if (!script || !style) throw new Error('Expected one Vite script and stylesheet.');
const js = await readFile(`dist${script[1]}`, 'utf8');
const css = await readFile(`dist${style[1]}`, 'utf8');
html = html.replace(script[0], () => `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`);
html = html.replace(style[0], () => `<style>${css}</style>`);
await writeFile('play.html', html);
console.log('Offline game generated: play.html (open directly in a browser).');
