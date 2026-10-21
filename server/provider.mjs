const endpoint='https://api.higgsfield.ai/higgsfield/genjutsu/motion-transfer/v1.0';
export class ProviderError extends Error {constructor(message,status=502,uncertain=false){super(message);this.status=status;this.uncertain=uncertain}}
const credentials=env=>env.HF_CREDENTIALS||((env.HF_API_KEY_ID&&env.HF_API_KEY_SECRET)?`${env.HF_API_KEY_ID}:${env.HF_API_KEY_SECRET}`:'');
export function providerConfigured(env){return Boolean(credentials(env))}
export function validateGeneration(data){
 const url=value=>{try {const u=new URL(value);return u.protocol==='https:'&&u.hostname&&!['localhost','127.0.0.1'].includes(u.hostname)&&value.length<=2083}catch{return false}};
 if(!data||!url(data.video_url)||!Array.isArray(data.image_urls)||data.image_urls.length<1||data.image_urls.length>8||!data.image_urls.every(url)||typeof(data.prompt??'')!=='string'||(data.prompt??'').length>10000||!['480p','720p','1080p'].includes(data.resolution??'720p'))throw new ProviderError('Provide public HTTPS video_url, 1–8 image_urls and a valid resolution',400);
 return {video_url:data.video_url,image_urls:data.image_urls,prompt:data.prompt??'',resolution:data.resolution??'720p'};
}
export async function submitGeneration(input,id,env,fetchImpl=fetch){
 if(!providerConfigured(env))throw new ProviderError('Generation provider unavailable',503);
 let response;
 try{response=await fetchImpl(endpoint,{method:'POST',headers:{Authorization:`Key ${credentials(env)}`,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify(input),signal:AbortSignal.timeout(25000)})}catch{throw new ProviderError('Provider response unknown; request retained for reconciliation',502,true)}
 if(!response.ok)throw new ProviderError('Generation provider rejected request',502);
 let json;try{json=await response.json()}catch{throw new ProviderError('Provider response unknown; request retained for reconciliation',502,true)}
 if(!json.request_id||!json.status_url||!safeStatusUrl(json.status_url))throw new ProviderError('Provider response unknown; request retained for reconciliation',502,true);
 return {requestId:json.request_id,statusUrl:json.status_url,status:json.status};
}
export function safeStatusUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='api.higgsfield.ai'&&/^\/requests\/[A-Za-z0-9_-]+\/status$/.test(u.pathname)&&!u.search&&!u.hash}catch{return false}}
export async function checkGeneration(statusUrl,env,fetchImpl=fetch){
 if(!safeStatusUrl(statusUrl))throw new ProviderError('Invalid provider status URL');
 const res=await fetchImpl(statusUrl,{headers:{Authorization:`Key ${credentials(env)}`},signal:AbortSignal.timeout(10000)});
 if(!res.ok)throw new ProviderError('Provider status unavailable');
 const data=await res.json();
 return {status:data.status,outputUrl:data.status==='completed'?data.video?.url??null:null};
}
