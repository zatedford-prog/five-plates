// Renders the app icon (five plates: two grown-ups, three kids) to the PNG sizes iPhones and Android want.
import sharp from 'sharp';
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1F5E55"/>
  <g transform="translate(256 256) scale(${1 - pad}) translate(-256 -256)">
    <circle cx="176" cy="200" r="70" fill="#F3F6F2"/><circle cx="176" cy="200" r="44" fill="none" stroke="#DCEBE5" stroke-width="8"/>
    <circle cx="336" cy="200" r="70" fill="#F3F6F2"/><circle cx="336" cy="200" r="44" fill="none" stroke="#DCEBE5" stroke-width="8"/>
    <circle cx="146" cy="352" r="46" fill="#F2C94C"/>
    <circle cx="256" cy="352" r="46" fill="#F2C94C"/>
    <circle cx="366" cy="352" r="46" fill="#F2C94C"/>
  </g>
</svg>`;
const jobs = [['apple-touch-icon.png', 180, 0.08], ['icon-192.png', 192, 0.08], ['icon-512.png', 512, 0.08], ['icon-maskable-512.png', 512, 0.22]];
for (const [name, size, pad] of jobs) await sharp(Buffer.from(svg(pad))).resize(size, size).png().toFile('public/icons/' + name);
await sharp(Buffer.from(svg(0.08))).resize(64, 64).png().toFile('public/favicon.png');
console.log('icons written');
