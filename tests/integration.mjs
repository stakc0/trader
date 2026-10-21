import test from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {createHandler} from '../server/handler.mjs';
import {sessionHash} from '../server/auth.mjs';
import {MINT,TOKEN,TOKEN_2022} from '../server/wallet.mjs';
import {submitGeneration,validateGeneration} from '../server/provider.mjs';
const {encode}=bs58;
const uid='11111111-1111-4111-8111-111111111111',cid='22222222-2222-4222-8222-222222222222',gid='33333333-3333-4333-8333-333333333333';
function fakeDb(){
 const data={profiles:[],sessions:[],wallet_challenges:[],generations:[],personas:[],posts:[]};
 return {configured:true,data,
  async request(table,{method='GET',query={}}={}){
   if(method==='DELETE'){data[table]=data[table].filter(x=>!Object.entries(query).every(([k,v])=>x[k]===v.slice(3)));return null}
   return data[table].filter(x=>Object.entries(query).every(([k,v])=>!v.startsWith('eq.')||x[k]===v.slice(3))).map(x=>({...x}));
  },
  async insert(table,record){const value={id:table==='wallet_challenges'?cid:table==='generations'?gid:uid,...record};data[table].push(value);return [{...value}]},
  async update(table,record,query){const item=data[table].find(x=>x.id===query.id.slice(3));Object.assign(item,record);return [{...item}]},
  async list(table,userId){return data[table].filter(x=>x.user_id===userId).map(x=>({...x}))},
  async rpc(name,args){if(name==='claim_wallet_challenge'){const x=data.wallet_challenges.find(x=>x.id===args.p_id&&x.user_id===args.p_user&&x.address===args.p_address&&x.nonce_hash===args.p_nonce_hash&&!x.consumed_at&&new Date(x.expires_at)>new Date());if(!x)return false;x.consumed_at=new Date().toISOString();data.profiles[0].wallet_address=x.address;return true}
   if(name==='reserve_generation'){data.profiles[0].credits_spent++;data.generations.push({id:gid,user_id:args.p_user,status:'reserved'});return gid}
   if(name==='finish_generation'){const x=data.generations[0];x.status=args.p_status;x.status_url=args.p_status_url; x.provider_request_id=args.p_request_id;if(args.p_status==='failed')data.profiles[0].credits_spent--;return true}
  }
 };
}
function request(path,method='GET',body,headers={}){return new Request('http://localhost'+path,{method,headers:{origin:'http://localhost','content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)})}
const rpcFetch=async(_url,req)=>{const {method,params}=JSON.parse(req.body);let result;
 if(method==='getAccountInfo')result={value:{owner:TOKEN}};
 if(method==='getTokenSupply')result={value:{amount:'100000000000',decimals:6}};
 if(method==='getTokenAccountsByOwner')result={value:params[1].programId===TOKEN?[{account:{owner:TOKEN,data:{parsed:{info:{mint:MINT,owner:params[0],state:'initialized',tokenAmount:{amount:'2000000000',decimals:6}}}}}}]:[]};
 return {ok:true,json:async()=>({result})};
};
test('signup creates durable session and me omits password hash; logout revokes',async()=>{
 const db=fakeDb(),handler=createHandler({db,env:{}});
 const signup=await handler(request('/api/auth/signup','POST',{username:'ALICE_1',password:'a secure password'}));
 assert.equal(signup.status,201);assert.equal(db.data.profiles[0].username,'alice_1');
 const cookie=signup.headers.get('set-cookie').split(';')[0];assert.ok(db.data.sessions[0].token_hash===sessionHash(cookie.split('=')[1]));
 const me=await handler(request('/api/me','GET',undefined,{cookie}));assert.equal(me.status,200);assert.ok(!('password_hash' in (await me.json()).user));
 const logout=await handler(request('/api/auth/logout','POST',{}, {cookie}));assert.equal(logout.status,200);
 assert.equal((await handler(request('/api/me','GET',undefined,{cookie}))).status,401);
});
test('wallet challenge signature cannot be replayed',async()=>{
 const pair=nacl.sign.keyPair(),address=encode(pair.publicKey),db=fakeDb();db.data.profiles.push({id:uid,username:'alice',credits_spent:0});db.data.sessions.push({user_id:uid,token_hash:sessionHash('the-session-token-with-enough-entropy-123456789'),expires_at:new Date(Date.now()+100000).toISOString()});
 const handler=createHandler({db,env:{}}),cookie='trader_session=the-session-token-with-enough-entropy-123456789';
 const challenge=await handler(request('/api/wallet/challenge','POST',{address},{cookie}));assert.equal(challenge.status,200);
 const data=await challenge.json(),signature=encode(nacl.sign.detached(new TextEncoder().encode(data.message),pair.secretKey));
 const proof={challenge_id:data.challenge_id,address,nonce:data.nonce,signature};
 assert.equal((await handler(request('/api/wallet/verify','POST',proof,{cookie}))).status,200);
 assert.equal((await handler(request('/api/wallet/verify','POST',proof,{cookie}))).status,409);
});
test('missing mint does not create token credits',async()=>{
 const pair=nacl.sign.keyPair(),db=fakeDb();db.data.profiles.push({id:uid,username:'alice',wallet_address:encode(pair.publicKey),credits_spent:0});db.data.sessions.push({user_id:uid,token_hash:sessionHash('the-session-token-with-enough-entropy-123456789'),expires_at:new Date(Date.now()+100000).toISOString()});
 const handler=createHandler({db,env:{SOLANA_RPC_URL:'https://rpc.example'},fetchImpl:async()=>({ok:true,json:async()=>({result:{value:null}})})});
 const response=await handler(request('/api/credits','GET',undefined,{cookie:'trader_session=the-session-token-with-enough-entropy-123456789'}));const result=await response.json();
 assert.equal(result.status,'unavailable');assert.equal(result.available,0);
});
test('provider submission uses documented endpoint and idempotency key',async()=>{
 let captured;const input=validateGeneration({video_url:'https://example.org/video.mp4',image_urls:['https://example.org/a.jpg']});
 await submitGeneration(input,gid,{HF_API_KEY_ID:'id',HF_API_KEY_SECRET:'secret'},async(url,init)=>{captured={url,init};return {ok:true,json:async()=>({status:'queued',request_id:'r1',status_url:'https://api.higgsfield.ai/requests/r1/status'})}});
 assert.equal(captured.url,'https://api.higgsfield.ai/higgsfield/genjutsu/motion-transfer/v1.0');
 assert.equal(captured.init.headers['Idempotency-Key'],gid);
 assert.equal(captured.init.headers.Authorization,'Key id:secret');
});
test('public posts expose author usernames without profile hashes',async()=>{
 const db=fakeDb();db.data.profiles.push({id:uid,username:'alice',password_hash:'secret'});db.data.posts.push({id:gid,user_id:uid,body:'hello'});
 const r=await createHandler({db,env:{}})(request('/api/posts'));
 assert.equal(r.status,200);const body=await r.json();assert.equal(body.items[0].username,'alice');assert.ok(!('password_hash' in body.items[0]));
});
test('profile, post and persona accept actual frontend payload keys',async()=>{
 const db=fakeDb();db.data.profiles.push({id:uid,username:'alice',credits_spent:0});db.data.sessions.push({user_id:uid,token_hash:sessionHash('the-session-token-with-enough-entropy-123456789'),expires_at:new Date(Date.now()+100000).toISOString()});
 const h=createHandler({db,env:{}}),cookie='trader_session=the-session-token-with-enough-entropy-123456789';
 const profile=await h(request('/api/profile','POST',{bio:'hello',tiktok_url:'https://www.tiktok.com/@alice'},{cookie}));assert.equal(profile.status,200);assert.equal((await profile.json()).user.tiktok_url,'https://www.tiktok.com/@alice');
 const persona=await h(request('/api/personas','POST',{name:'Hero',bio:'persona bio'},{cookie}));assert.equal(persona.status,201);assert.equal((await persona.json()).item.description,'persona bio');
 const post=await h(request('/api/posts','POST',{body:'hello',media_url:'https://example.com/a.jpg'},{cookie}));assert.equal(post.status,201);assert.equal((await post.json()).item.media_url,'https://example.com/a.jpg');
});
test('missing mint blocks generation before reservation even with provider keys',async()=>{
 const pair=nacl.sign.keyPair(),db=fakeDb();db.data.profiles.push({id:uid,username:'alice',wallet_address:encode(pair.publicKey),credits_spent:0});db.data.sessions.push({user_id:uid,token_hash:sessionHash('the-session-token-with-enough-entropy-123456789'),expires_at:new Date(Date.now()+100000).toISOString()});
 let providerCalled=false;
 const handler=createHandler({db,env:{SOLANA_RPC_URL:'https://rpc.example',HF_API_KEY_ID:'id',HF_API_KEY_SECRET:'secret'},fetchImpl:async url=>{if(String(url).includes('higgsfield'))providerCalled=true;return {ok:true,json:async()=>({result:{value:null}})}}});
 const r=await handler(request('/api/generations','POST',{video_url:'https://example.org/v.mp4',image_urls:['https://example.org/i.jpg']},{cookie:'trader_session=the-session-token-with-enough-entropy-123456789'}));
 assert.equal(r.status,503);assert.equal(db.data.profiles[0].credits_spent,0);assert.equal(db.data.generations.length,0);assert.equal(providerCalled,false);
});

test('configured generation reserves only after verified live holdings',async()=>{
 const pair=nacl.sign.keyPair(),db=fakeDb();db.data.profiles.push({id:uid,username:'alice',wallet_address:encode(pair.publicKey),credits_spent:0});db.data.sessions.push({user_id:uid,token_hash:sessionHash('the-session-token-with-enough-entropy-123456789'),expires_at:new Date(Date.now()+100000).toISOString()});
 const handler=createHandler({db,env:{SOLANA_RPC_URL:'https://rpc.example',HF_API_KEY_ID:'id',HF_API_KEY_SECRET:'secret'},fetchImpl:async(url,req)=>url.includes('higgsfield')?{ok:true,json:async()=>({status:'queued',request_id:'r1',status_url:'https://api.higgsfield.ai/requests/r1/status'})}:rpcFetch(url,req)});
 const r=await handler(request('/api/generations','POST',{video_url:'https://example.org/video.mp4',image_urls:['https://example.org/a.jpg']},{cookie:'trader_session=the-session-token-with-enough-entropy-123456789'}));
 assert.equal(r.status,202);assert.equal(db.data.profiles[0].credits_spent,1);assert.equal(db.data.generations[0].status,'queued');
});
