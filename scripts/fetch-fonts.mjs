// One-time helper: downloads the two Google fonts (Latin subset) so the app never waits on another server.
import { writeFile } from 'node:fs/promises';
const url = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Nunito+Sans:opsz,wght@6..12,400..800&display=swap';
const css = await (await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' } })).text();
const blocks = css.split('/* ').filter(b => b.startsWith('latin */'));
let out = '';
for (const b of blocks) {
  const family = b.match(/font-family: '([^']+)'/)[1];
  const src = b.match(/url\((https:[^)]+\.woff2)\)/)[1];
  const file = family.toLowerCase().replace(/\s+/g, '-') + '.woff2';
  await writeFile('public/fonts/' + file, Buffer.from(await (await fetch(src)).arrayBuffer()));
  out += b.slice('latin */'.length).replace(/url\([^)]+\)/, `url(/fonts/${file})`).trim() + '\n';
}
await writeFile('public/fonts/fonts.css', out);
console.log(out);
