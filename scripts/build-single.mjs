/* Builds dist-single/Eddy.html: the browser-only build in one file, with the starter library
   (public/seed/library.json and its sounds) embedded, so it works offline when opened from disk. */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

execSync('npx vite build --config vite.single.config.ts --mode demo', { stdio: 'inherit' });
const out = 'dist-single';
let html = readFileSync(path.join(out, 'index.html'), 'utf8');
const seed = 'public/seed';
const files = { 'library.json': readFileSync(path.join(seed, 'library.json')).toString('base64') };
for (const f of readdirSync(path.join(seed, 'audio'))) files['audio/' + f] = readFileSync(path.join(seed, 'audio', f)).toString('base64');
const types = { json: 'application/json', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4' };
// serve fetch('./seed/...') from the embedded copy
const shim = `<script>(function(){var S=${JSON.stringify(files)};var T=${JSON.stringify(types)};var f=window.fetch.bind(window);
window.fetch=function(u,o){var s=typeof u==='string'?u:(u&&u.url)||'';var m=/(?:^|\\/)seed\\/(.+?)(?:[?#].*)?$/.exec(s);var k=m&&decodeURIComponent(m[1]);
if(k&&S[k]){var b=atob(S[k]),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);
return Promise.resolve(new Response(a,{status:200,headers:{'Content-Type':T[k.split('.').pop()]||'application/octet-stream'}}));}return f(u,o);};})();</script>`;
html = html.replace('<head>', '<head>' + shim);
rmSync(path.join(out, 'index.html'));
writeFileSync(path.join(out, 'Eddy.html'), html);
console.log(`dist-single/Eddy.html: ${(html.length / 1e6).toFixed(1)} MB, ${Object.keys(files).length - 1} sounds embedded`);
