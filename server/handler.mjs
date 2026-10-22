import { randomBytes,createHash } from 'node:crypto';
import { Store,DbError } from './store.mjs';
import { hashPassword,checkPassword,newSessionToken,sessionHash,sessionCookie,parseCookie } from './auth.mjs';
import { MINT,validAddress,challengeMessage,verifyWalletSignature,tokenHoldings,creditsFor,RpcError,TOKEN,TOKEN_2022 } from './wallet.mjs';
import { providerConfigured,validateGeneration,submitGeneration,checkGeneration,ProviderError } from './provider.mjs';
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const bad=(message,status=400)=>{const e=new Error(message);e.status=status;throw e};
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const publicProfile=p=>({id:p.id,username:p.username,display_name:p.display_name,bio:p.bio,tiktok_handle:p.tiktok_handle,tiktok_url:p.tiktok_url,wallet_address:p.wallet_address,created_at:p.created_at});
async function body(req){const text=await req.text();if(text.length>32000000)bad('Request too large',413);try{const x=JSON.parse(text);if(!x||Array.isArray(x)||typeof x!=='object')bad('Expected JSON object');return x}catch(e){if(e.status)throw e;bad('Invalid JSON')}}
function originGuard(req,url){if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return;const origin=req.headers.get('origin');const host=req.headers.get('x-forwarded-host')||req.headers.get('host')||url.host; if(origin){let u;try{u=new URL(origin)}catch{bad('Invalid origin',403)}if(u.host!==host||!(u.protocol==='https:'||(u.protocol==='http:'&&/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))))bad('Cross-origin request rejected',403)}else if(req.headers.get('cookie'))bad('Origin required',403)}
async function storeDataUrl(data,env,fetchImpl,kind){const m=/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(data||''));if(!m)throw new ProviderError(`Invalid ${kind} upload`,400);const bytes=Buffer.from(m[2],'base64');const max=kind==='video'?20*1024*1024:8*1024*1024;if(bytes.length>max)throw new ProviderError(`${kind} is too large`,413);const ext=m[1].split('/')[1].replace('jpeg','jpg');const path=`${kind}/${crypto.randomUUID()}.${ext}`;const url=`${env.SUPABASE_URL}/storage/v1/object/trader-media/${path}`;const r=await fetchImpl(url,{method:'POST',headers:{Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,apikey:env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':m[1],'x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(30000)});if(!r.ok)throw new ProviderError(`${kind} upload failed`,502);return `${env.SUPABASE_URL}/storage/v1/object/public/trader-media/${path}`}
export function createHandler({env=process.env,db=new Store(env),fetchImpl=fetch}={}){
 return async req=>{
 try{
  const url=new URL(req.url),path=url.pathname,method=req.method;
  if(!path.startsWith('/api/'))return json({error:'Not found'},404);
  if(env.TRADER_API_PAUSED==='true')return json({error:'Trader API temporarily paused'},503,{'retry-after':'3600'});
  originGuard(req,url);
  if(path==='/api/config'&&method==='GET')return json({mint:MINT,credits_policy:'1 credit per 1,000 whole tokens held; live RPC verification before each debit; spent credits remain spent if tokens leave wallet',provider:providerConfigured(env)?'configured':'unavailable',database:!!db.configured,market:'live RPC / DexScreener when available',tiktok:'user-supplied handle; not OAuth verified',rpc:Boolean(env.SOLANA_RPC_URL),grpc:Boolean(env.SOLANA_GRPC_ENDPOINT&&env.SOLANA_GRPC_X_TOKEN),grpc_description:'confirmed Yellowstone activity worker; feed may be empty until mint exists'});
  if(path==='/api/market'&&method==='GET'){
   if(!env.SOLANA_RPC_URL)return json({mint:MINT,status:'unavailable',reason:'RPC not configured'});
   try{
    const call=async(method,params)=>{const r=await fetchImpl(env.SOLANA_RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(9000)});if(!r.ok)throw Error();const x=await r.json();if(x.error)throw Error();return x.result};
    const info=await call('getAccountInfo',[MINT,{encoding:'base64',commitment:'confirmed'}]);
    if(!info?.value||![TOKEN,TOKEN_2022].includes(info.value.owner))return json({mint:MINT,status:'unavailable',reason:'Mint not found on Solana'});
    const supply=await call('getTokenSupply',[MINT,{commitment:'confirmed'}]);
    const result={mint:MINT,status:'live',raw_supply:supply.value.amount,decimals:supply.value.decimals,price_usd:null,volume_24h_usd:null};
    try{const r=await fetchImpl(`https://api.dexscreener.com/latest/dex/tokens/${MINT}`,{signal:AbortSignal.timeout(6000)});if(r.ok){const x=await r.json();const pairs=(x.pairs||[]).filter(p=>p.chainId==='solana'&&(p.baseToken?.address===MINT||p.quoteToken?.address===MINT));pairs.sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0));if(pairs[0]){result.price_usd=pairs[0].baseToken?.address===MINT?pairs[0].priceUsd:null;result.volume_24h_usd=pairs[0].volume?.h24??null;result.pair_address=pairs[0].pairAddress}}}catch{}
    return json(result);
   }catch{return json({mint:MINT,status:'unavailable',reason:'Market RPC unavailable'})}
  }
  if(!db.configured)return json({error:'Database unavailable'},503);
  if(path==='/api/activity'&&method==='GET'){
   const items=await db.request('token_activity',{query:{mint:`eq.${MINT}`,select:'signature,slot,mint,changes,created_at',order:'slot.desc',limit:'30'}});
   return json({mint:MINT,items,source:'confirmed Yellowstone gRPC token-balance updates',classification:'token movement; buy/sell not inferred'});
  }
  if(path.startsWith('/api/profiles/')&&method==='GET'){
   let username;try{username=decodeURIComponent(path.slice('/api/profiles/'.length))}catch{bad('Invalid username')}
   if(!/^[a-z0-9_]{3,30}$/.test(username))bad('Invalid username');
   const [person]=await db.request('profiles',{query:{username:`eq.${username}`,select:'id,username,display_name,bio,tiktok_url,created_at',limit:'1'}});
   if(!person)bad('Profile not found',404);
   const posts=await db.request('posts',{query:{user_id:`eq.${person.id}`,select:'id,body,media_url,video_url,created_at',order:'created_at.desc',limit:'30'}});
   return json({profile:person,posts});
  }
  if(path==='/api/posts'&&method==='GET'){
   const posts=await db.request('posts',{query:{select:'id,user_id,persona_id,body,media_url,video_url,created_at',order:'created_at.desc',limit:'50'}});
   const ids=[...new Set(posts.map(p=>p.user_id))];
   const authors=ids.length?await db.request('profiles',{query:{id:`in.(${ids.join(',')})`,select:'id,username,tiktok_url'}}):[];
   const names=new Map(authors.map(p=>[p.id,p]));
   return json({items:posts.map(p=>({...p,username:names.get(p.user_id)?.username||'trader',tiktok_url:names.get(p.user_id)?.tiktok_url||null}))});
  }
  if((path==='/api/auth/signup'||path==='/api/auth/login')&&method==='POST'){
   const data=await body(req),username=typeof data.username==='string'?data.username.trim().toLowerCase():'';
   if(!/^[a-z0-9_]{3,30}$/.test(username)||typeof data.password!=='string'||data.password.length<12||data.password.length>256)bad('Username must be 3–30 lowercase letters, digits or underscores; password 12–256 characters');
   let profile;
   if(path.endsWith('signup')){
    const hash=await hashPassword(data.password);
    [profile]=await db.insert('profiles',{username,password_hash:hash});
   }else{
    if(await db.rpc('auth_rate_check',{p_username:username})===false)bad('Too many login attempts; try again later',429);
    const found=await db.request('profiles',{query:{username:`eq.${username}`,select:'*',limit:'1'}});
    const ok=found[0]&&await checkPassword(data.password,found[0].password_hash);
    if(!ok){await db.rpc('auth_rate_record',{p_username:username,p_success:false});bad('Invalid credentials',401)}
    await db.rpc('auth_rate_record',{p_username:username,p_success:true});
    profile=found[0];
   }
   const token=newSessionToken();
   await db.insert('sessions',{token_hash:sessionHash(token),user_id:profile.id,expires_at:new Date(Date.now()+7*86400000).toISOString()});
   return json({user:publicProfile(profile)},path.endsWith('signup')?201:200,{'set-cookie':sessionCookie(token,{secure:!['localhost','127.0.0.1'].includes(url.hostname)})});
  }
  if(path==='/api/character-sheet'&&method==='POST'){
   if(!env.OPENROUTER_API_KEY)return json({error:'Character sheet provider is not configured'},503);
   const input=await body(req); const images=Array.isArray(input.image_urls)?input.image_urls:(input.image_url?[input.image_url]:[]); if(images.length!==1||!images.every(image=>(/^https:\/\//.test(image)&&image.length<=2083)||(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)&&image.length<=11000000)))bad('Upload up to 3 PNG, JPG, or WebP reference images');
   const prompt='Create a professional photorealistic character reference sheet for one original fictional influencer, using the reference photos.\n\nDisplay the exact same person consistently across every panel:\n1. straight-on neutral headshot\n2. left three-quarter facial view\n3. right three-quarter facial view\n4. clean left profile\n5. clean right profile\n6. waist-up natural smile\n7. full-body front view\n8. full-body side view\n9. expression strip showing neutral, friendly smile, laughing, speaking, surprised, and thoughtful\n\nPreserve realistic pores, tiny skin variations, fine facial hair, subtle asymmetry and believable under-eye texture. Arrange all panels cleanly on one professional reference sheet with consistent neutral lighting, plain studio background, and no text, labels, logos, or watermarks.';
   let response; try{response=await fetchImpl('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${env.OPENROUTER_API_KEY}`,'Content-Type':'application/json','HTTP-Referer':env.SITE_URL||'https://www.usetrader.app','X-Title':'TRENCHER Character Studio'},body:JSON.stringify({model:'google/gemini-3.1-flash-image-preview',modalities:['text','image'],messages:[{role:'user',content:[{type:'text',text:prompt},...images.map(url=>({type:'image_url',image_url:{url}}))]}]}),signal:AbortSignal.timeout(120000)});}catch{ return json({error:'Character sheet provider timed out'},502) }
   if(!response.ok)return json({error:'Character sheet provider rejected the request'},502); let result; try{result=await response.json()}catch{return json({error:'Invalid character sheet provider response'},502)}
   const findImage=value=>{if(typeof value==='string'&&(value.startsWith('data:image/')||/^https:\/\//.test(value)))return value;if(Array.isArray(value)){for(const item of value){const found=findImage(item);if(found)return found}}else if(value&&typeof value==='object'){for(const item of Object.values(value)){const found=findImage(item);if(found)return found}}return null}; const imageUrl=findImage(result); if(!imageUrl)return json({error:'Provider returned no character sheet image'},502); let historyUrl=imageUrl;if(imageUrl.startsWith('data:')){try{historyUrl=await storeDataUrl(imageUrl,env,fetchImpl,'character-sheet')}catch{}} if(db.configured){try{await db.insert('character_sheets',{image_url:historyUrl})}catch{}} return json({image_url:imageUrl},200);
  }
  if(path==='/api/character-sheets'&&method==='GET'){const items=db.configured?await db.request('character_sheets',{query:{select:'id,image_url,created_at',order:'created_at.desc',limit:'24'}}):[];return json({items});}
  const token=parseCookie(req.headers.get('cookie'),'trader_session');
  if(!token||!/^[-_A-Za-z0-9]{32,128}$/.test(token))bad('Authentication required',401);
  const sessions=await db.request('sessions',{query:{token_hash:`eq.${sessionHash(token)}`,expires_at:`gt.${new Date().toISOString()}`,select:'user_id',limit:'1'}});
  if(!sessions[0])bad('Session expired',401);
  const people=await db.request('profiles',{query:{id:`eq.${sessions[0].user_id}`,select:'*',limit:'1'}});
  const user=people[0];if(!user)bad('Authentication required',401);
  if(path==='/api/auth/logout'&&method==='POST'){
   await db.request('sessions',{method:'DELETE',query:{token_hash:`eq.${sessionHash(token)}`}});
   return json({ok:true},200,{'set-cookie':sessionCookie('',{secure:!['localhost','127.0.0.1'].includes(url.hostname),maxAge:0})});
  }
  if(path==='/api/me'&&method==='GET')return json({user:publicProfile(user)});
  if(path==='/api/profile'){
   if(method==='GET')return json({user:publicProfile(user)});
   if(method==='PATCH'||method==='PUT'||method==='POST'){
    const input=await body(req),edit={};
    if(Object.hasOwn(input,'display_name')){if(typeof input.display_name!=='string'||input.display_name.length>80)bad('Invalid display name');edit.display_name=input.display_name}
    if(Object.hasOwn(input,'bio')){if(typeof input.bio!=='string'||input.bio.length>500)bad('Invalid bio');edit.bio=input.bio}
    if(Object.hasOwn(input,'tiktok_handle')){let handle=input.tiktok_handle;if(handle!==null){if(typeof handle!=='string'||!/^@?[A-Za-z0-9._]{1,24}$/.test(handle))bad('Invalid TikTok handle');handle=handle.replace(/^@/,'')}edit.tiktok_handle=handle;edit.tiktok_url=handle?`https://www.tiktok.com/@${handle}`:null}
    if(Object.hasOwn(input,'tiktok_url')){let link=input.tiktok_url;if(link==='')link=null;if(link!==null){if(typeof link!=='string'||!/^https:\/\/(www[.])?tiktok[.]com\/@[A-Za-z0-9._]{1,24}\/?$/.test(link))bad('Invalid TikTok profile URL');link=link.replace(/\/$/,'');edit.tiktok_handle=link.split('/@')[1]}else edit.tiktok_handle=null;edit.tiktok_url=link}
    if(!Object.keys(edit).length)bad('No editable fields');
    const [updated]=await db.update('profiles',edit,{id:`eq.${user.id}`});return json({user:publicProfile(updated)});
   }
  }
  for(const [route,table] of [['/api/personas','personas'],['/api/posts','posts']]){
   if(path===route&&method==='GET')return json({items:await db.list(table,user.id)});
   if(path===route&&method==='POST'){
    const input=await body(req);let record={user_id:user.id};
    if(table==='personas'){
     if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80||typeof(input.description??input.bio??'')!=='string'||(input.description??input.bio??'').length>2000)bad('Invalid persona');
     record={...record,name:input.name.trim(),description:input.description??input.bio??''};
     if(input.image_url!==undefined){if(!safePublicUrl(input.image_url))bad('Invalid image URL');record.image_url=input.image_url}
    }else{
     if(typeof input.body!=='string'||!input.body.trim()||input.body.length>5000)bad('Invalid post');
     record={...record,body:input.body.trim()};
     if(input.persona_id){if(!uuid(input.persona_id))bad('Invalid persona ID');const own=await db.request('personas',{query:{id:`eq.${input.persona_id}`,user_id:`eq.${user.id}`,select:'id'}});if(!own.length)bad('Persona not found',404);record.persona_id=input.persona_id}
     if(input.media_url){if(!safePublicUrl(input.media_url))bad('Invalid media URL');record.media_url=input.media_url}
     if(input.video_url){if(!safePublicUrl(input.video_url))bad('Invalid video URL');record.video_url=input.video_url}
    }
    const [created]=await db.insert(table,record);return json({item:created},201);
   }
   if(path.startsWith(route+'/')){const id=path.slice(route.length+1);if(!uuid(id))bad('Invalid ID');
    if(method==='DELETE'){await db.request(table,{method:'DELETE',query:{id:`eq.${id}`,user_id:`eq.${user.id}`}});return json({ok:true})}
   }
  }
  if(path==='/api/wallet/challenge'&&method==='POST'){
   const data=await body(req);if(!validAddress(data.address))bad('Invalid wallet address');
   const nonce=randomBytes(32).toString('base64url');const expiry=new Date(Date.now()+5*60000).toISOString();
   const [challenge]=await db.insert('wallet_challenges',{user_id:user.id,address:data.address,nonce_hash:createHash('sha256').update(nonce).digest('hex'),expires_at:expiry});
   return json({challenge_id:challenge.id,nonce,message:challengeMessage(user.id,data.address,nonce),expires_at:expiry});
  }
  if(path==='/api/wallet/verify'&&method==='POST'){
   const data=await body(req);if(!uuid(data.challenge_id)||!validAddress(data.address)||typeof data.nonce!=='string'||typeof data.signature!=='string')bad('Invalid wallet proof');
   const message=challengeMessage(user.id,data.address,data.nonce);
   if(!verifyWalletSignature(data.address,message,data.signature))bad('Invalid wallet signature',403);
   const claimed=await db.rpc('claim_wallet_challenge',{p_id:data.challenge_id,p_user:user.id,p_address:data.address,p_nonce_hash:createHash('sha256').update(data.nonce).digest('hex')});
   if(!claimed)bad('Challenge expired or already used',409);
   return json({verified:true,address:data.address});
  }
  if(path==='/api/credits'&&method==='GET'){
   if(!user.wallet_address)return json({mint:MINT,status:'unavailable',reason:'Wallet not linked',available:0,spent:Number(user.credits_spent)||0});
   try{const holding=await tokenHoldings(user.wallet_address,env.SOLANA_RPC_URL,fetchImpl);const entitlement=creditsFor(holding.rawAmount,holding.decimals);return json({mint:MINT,status:'live',wallet_address:user.wallet_address,raw_amount:holding.rawAmount,decimals:holding.decimals,entitlement,spent:Number(user.credits_spent),available:Math.max(0,entitlement-Number(user.credits_spent))})}
   catch(e){if(!(e instanceof RpcError))throw e;return json({mint:MINT,status:'unavailable',reason:e.message,available:0,spent:Number(user.credits_spent)||0})}
  }
  if(path==='/api/holder-gate'&&method==='GET'){const wallet=url.searchParams.get('wallet');if(!validAddress(wallet))return json({eligible:false,reason:'Connect a valid wallet'},400);try{const h=await tokenHoldings(wallet,env.SOLANA_RPC_URL,fetchImpl);const whole=BigInt(h.rawAmount)/(10n**BigInt(h.decimals));return json({eligible:whole>=1000000n,whole_tokens:whole.toString(),required_tokens:'1000000',mint:MINT})}catch(e){return json({eligible:false,reason:e.message||'Holder balance unavailable'},200)}}
  if(path==='/api/generations/public'&&method==='POST'){
   const raw=await body(req);const wallet=raw.wallet;if(!validAddress(wallet))return json({error:'Connect your wallet to generate motion'},401);let holding;try{holding=await tokenHoldings(wallet,env.SOLANA_RPC_URL,fetchImpl)}catch(e){return json({error:e.message||'Could not verify holder balance'},503)}const whole=BigInt(holding.rawAmount)/(10n**BigInt(holding.decimals));if(whole<1000000n)return json({error:'Holder gate: hold at least 1,000,000 TRENCHER tokens'},403);const input=validateGeneration(raw); const guest='00000000-0000-0000-0000-000000000001'; if(!db.configured)return json({error:'Database unavailable'},503); let id; try{const [row]=await db.insert('generations',{user_id:guest,prompt:input.prompt,input,status:'reserved'});id=row.id;const job=await submitGeneration(input,id,env,fetchImpl);await db.rpc('finish_generation',{p_id:id,p_user:guest,p_status:'queued',p_request_id:job.requestId,p_status_url:job.statusUrl});return json({id,status:'queued'},202)}catch(e){if(id&&e instanceof ProviderError){try{await db.rpc('finish_generation',{p_id:id,p_user:guest,p_status:e.uncertain?'submission_unknown':'failed',p_error:e.message})}catch{}}if(e instanceof ProviderError)return json({error:e.message},e.status);throw e}
  }
  if(path==='/api/generations/public'&&method==='GET'){
   const rows=db.configured?await db.request('generations',{query:{select:'id,user_id,status,output_url,error,created_at,updated_at',order:'created_at.desc',limit:'40'}}):[];
   for(const item of rows){if(item.status==='queued'&&item.status_url&&providerConfigured(env)){try{const state=await checkGeneration(item.status_url,env,fetchImpl);if(state.status==='completed'&&state.outputUrl){await db.rpc('finish_generation',{p_id:item.id,p_user:item.user_id,p_status:'completed',p_output_url:state.outputUrl});item.status='completed';item.output_url=state.outputUrl}else if(['failed','error','nsfw','rejected','cancelled','canceled'].includes(state.status)){await db.rpc('finish_generation',{p_id:item.id,p_user:item.user_id,p_status:'failed',p_error:'Provider reported failure'});item.status='failed'}}catch{}}}
   return json({items:rows.map(({user_id,...item})=>item)});
  }
  if(path==='/api/generations'&&method==='GET'){
   const rows=await db.list('generations',user.id);
   return json({items:rows});
  }
  if(path.startsWith('/api/generations/')&&method==='GET'){
   const id=path.slice('/api/generations/'.length);if(!uuid(id))bad('Invalid generation ID');
   const rows=await db.request('generations',{query:{id:`eq.${id}`,user_id:`eq.${user.id}`,select:'*'}});
   const item=rows[0];if(!item)bad('Generation not found',404);
   if(item.status==='queued'&&item.status_url&&providerConfigured(env)){
    try{const state=await checkGeneration(item.status_url,env,fetchImpl);if(state.status==='completed'&&state.outputUrl){await db.rpc('finish_generation',{p_id:id,p_user:user.id,p_status:'completed',p_output_url:state.outputUrl});item.status='completed';item.output_url=state.outputUrl}else if(['failed','error','nsfw','rejected','cancelled','canceled'].includes(state.status)){await db.rpc('finish_generation',{p_id:id,p_user:user.id,p_status:'failed',p_error:'Provider reported failure'});item.status='failed'}}catch{}
   }
   return json({item});
  }
  if(path==='/api/generations'&&method==='POST'){
   // Do not reserve, debit, or fabricate a job if the API cannot be called.
   if(!providerConfigured(env))return json({error:'Higgsfield API not configured; generation unavailable'},503);
   const raw=await body(req); if(raw.video_data||raw.image_data){raw.video_url=await storeDataUrl(raw.video_data,env,fetchImpl,'video');raw.image_urls=[await storeDataUrl(raw.image_data,env,fetchImpl,'image')];delete raw.video_data;delete raw.image_data} const input=validateGeneration(raw);
   if(!user.wallet_address)bad('Link a wallet first',403);
   const holding=await tokenHoldings(user.wallet_address,env.SOLANA_RPC_URL,fetchImpl);
   if(creditsFor(holding.rawAmount,holding.decimals)<=Number(user.credits_spent))bad('Insufficient verified token credits',409);
   let id;
   try{id=await db.rpc('reserve_generation',{p_user:user.id,p_input:input,p_raw:holding.rawAmount,p_decimals:holding.decimals})}catch(e){if(e instanceof DbError)bad('Could not reserve credit (balance may have changed)',409);throw e}
   try{
    const job=await submitGeneration(input,id,env,fetchImpl);
    await db.rpc('finish_generation',{p_id:id,p_user:user.id,p_status:'queued',p_request_id:job.requestId,p_status_url:job.statusUrl});
    return json({id,status:'queued',request_id:job.requestId},202);
   }catch(e){
    if(e instanceof ProviderError){await db.rpc('finish_generation',{p_id:id,p_user:user.id,p_status:e.uncertain?'submission_unknown':'failed',p_error:e.message});throw e}
    // A provider job may already exist; never refund when persistence is uncertain.
    throw e;
   }
  }
  return json({error:'Not found'},404);
 }catch(e){return json({error:e instanceof DbError?'Database unavailable':e.status?e.message:'Internal error'},e.status&&e.status>=400&&e.status<600?e.status:500)}
 };
}
function safePublicUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&value.length<=2083}catch{return false}}
