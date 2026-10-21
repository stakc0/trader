import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import api from '../api/index.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const assets={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css','/public/trader-mark.png':'public/trader-mark.png',...Object.fromEntries(['Regular','Medium','SemiBold','Bold'].map(weight=>[`/public/fonts/InterDisplay-${weight}.ttf`,`public/fonts/InterDisplay-${weight}.ttf`]))};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ttf':'font/ttf'};
const port=Number(process.env.PORT||4173);
http.createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path.startsWith('/api/'))return api(req,res);
 if(!['GET','HEAD'].includes(req.method)||!Object.hasOwn(assets,path)){res.writeHead(404);res.end('Not found');return}
 const name=assets[path];
 try{const file=await readFile(resolve(root,name));res.writeHead(200,{'Content-Type':types[name.slice(name.lastIndexOf('.'))],'X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:file)}
 catch{res.writeHead(404);res.end('Not found')}
}).listen(port,()=>console.log(`Trader server listening on ${port}`));
