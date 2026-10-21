import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
const root = process.cwd(); const port = Number(process.env.PORT || 4173);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
http.createServer(async (req,res)=>{let p=new URL(req.url,'http://localhost').pathname; if(p==='/'||!extname(p))p='/index.html'; try{const body=await readFile(join(root,p));res.writeHead(200,{'content-type':types[extname(p)]||'application/octet-stream'});res.end(body)}catch{res.writeHead(404);res.end('Not found')}}).listen(port,()=>console.log(`Trader preview: http://localhost:${port}`));
