import { mkdir, cp } from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for (const f of ['index.html','styles.css','app.js']) await cp(f,`dist/${f}`);
await mkdir('dist/public',{recursive:true});
await cp('public/trader-mark.png','dist/public/trader-mark.png');
await cp('public/fonts','dist/public/fonts',{recursive:true});
await cp('public/media','dist/public/media',{recursive:true});
console.log('Built trader into dist/');
