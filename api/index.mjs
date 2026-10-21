import { createHandler } from '../server/handler.mjs';
const handler=createHandler();
export default async function api(req,res){
 try{
  const host=req.headers['x-forwarded-host']||req.headers.host||'localhost';
  const scheme=req.headers['x-forwarded-proto']||'https';
  const url=new URL(req.url,`${scheme}://${host}`);
  // Rewrites may expose their destination URL rather than the original path.
  if(url.pathname==='/api/index'&&url.searchParams.has('apiPath')){
   const restored=url.searchParams.get('apiPath');
   if(/^[a-z0-9/_-]{1,100}$/i.test(restored))url.pathname='/api/'+restored;
   url.searchParams.delete('apiPath');
  }
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>40000){res.writeHead(413);res.end();return}chunks.push(chunk)}
  const request=new Request(url,{method:req.method,headers:req.headers,body:chunks.length?Buffer.concat(chunks):undefined,duplex:'half'});
  const response=await handler(request);
  res.statusCode=response.status;
  for(const [key,val] of response.headers)res.setHeader(key,val);
  res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.statusCode=500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Internal error'}))}
}
