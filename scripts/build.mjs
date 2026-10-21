import { mkdir, cp } from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for (const f of ['index.html','styles.css','app.js']) await cp(f,`dist/${f}`);
console.log('Built trader into dist/');
