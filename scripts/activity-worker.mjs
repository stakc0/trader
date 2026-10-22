import Client,{CommitmentLevel} from '@triton-one/yellowstone-grpc';
import { Store } from '../server/store.mjs';
import { MINT } from '../server/wallet.mjs';
import { normalizeActivity } from '../server/activity.mjs';

const env=process.env;
if(!env.SOLANA_GRPC_ENDPOINT||!env.SOLANA_GRPC_X_TOKEN||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Missing stream or database configuration');
const db=new Store(env);
let stopping=false, stream;
process.on('SIGTERM',()=>{stopping=true;stream?.end();process.exit(0)});
process.on('SIGINT',()=>{stopping=true;stream?.end();process.exit(0)});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let backoff=1000;
while(!stopping){
 try{
  const client=new Client(env.SOLANA_GRPC_ENDPOINT,env.SOLANA_GRPC_X_TOKEN,{'grpc.keepalive_time_ms':20000});
  // A subscription can start before the mint exists. It emits only matching confirmed transactions.
  stream=await client.subscribe();
  const request={accounts:{},slots:{},transactions:{mint:{vote:false,failed:false,accountInclude:[MINT],accountExclude:[],accountRequired:[]}},transactionsStatus:{},blocks:{},blocksMeta:{},entry:{},accountsDataSlice:[],commitment:CommitmentLevel.CONFIRMED};
  stream.write(request);
  backoff=1000;
  console.log('Confirmed Yellowstone stream subscribed for exact TRENCHER mint');
  await new Promise((resolve,reject)=>{
   let serial=Promise.resolve();
   stream.on('data',update=>{serial=serial.then(async()=>{
    const activity=normalizeActivity(update);
    if(!activity)return;
    await db.request('token_activity',{method:'POST',body:activity,prefer:'resolution=ignore-duplicates,return=minimal'});
    console.log('Recorded confirmed token-balance change at slot',activity.slot);
   }).catch(e=>{console.error('Activity persistence error',e.message);reject(e)})});
   stream.on('error',reject);stream.on('end',resolve);stream.on('close',resolve);
  });
 }catch(e){console.error('Yellowstone stream reconnecting:',e.code||e.message)}
 finally{stream?.end();stream=null}
 if(!stopping){await delay(backoff);backoff=Math.min(backoff*2,30000)}
}
