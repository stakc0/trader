export class DbError extends Error { constructor(message,status=503){super(message);this.status=status} }
export class Store {
 constructor(env=process.env,fetchImpl=fetch){
  this.url=env.SUPABASE_URL||env.SUPABASE_PROJECT_URL;
  this.key=env.SUPABASE_SERVICE_ROLE_KEY;
  this.fetch=fetchImpl;
 }
 get configured(){return !!(this.url&&this.key&&/^https:\/\//.test(this.url))}
 async request(path,{method='GET',body,query={},prefer}={}){
  if(!this.configured)throw new DbError('Database unavailable');
  const url=new URL(`/rest/v1/${path}`,this.url);
  for(const [k,v] of Object.entries(query))url.searchParams.set(k,v);
  let response;
  try{response=await this.fetch(url,{method,headers:{apikey:this.key,authorization:`Bearer ${this.key}`,'content-type':'application/json',...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)})}catch{throw new DbError('Database unavailable')}
  if(!response.ok){
   if(response.status===409)throw new DbError('Record already exists',409);
   throw new DbError('Database operation failed');
  }
  if(response.status===204)return null;
  try{return await response.json()}catch{throw new DbError('Database operation failed')}
 }
 list(table,userId,columns='*'){return this.request(table,{query:{user_id:`eq.${userId}`,select:columns,order:'created_at.desc',limit:'50'}})}
 insert(table,data){return this.request(table,{method:'POST',body:data,prefer:'return=representation'})}
 update(table,data,query){return this.request(table,{method:'PATCH',body:data,query:{...query,select:'*'},prefer:'return=representation'})}
 rpc(name,data){return this.request(`rpc/${name}`,{method:'POST',body:data})}
}
