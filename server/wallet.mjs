import nacl from 'tweetnacl';
import bs58 from 'bs58';
export const MINT='a5qFdexdutcopfoKbvYLrRDc2c8BDyLfh9GdhDWtrde';
export const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022='TokenzQdBNbLqP5VEhdkAS6EPFNY4hqXfG6DFaQPN';
export function validAddress(value){try{return typeof value==='string'&&bs58.decode(value).length===32}catch{return false}}
export const challengeMessage=(userId,address,nonce)=>`Trader wallet ownership verification\nUser: ${userId}\nWallet: ${address}\nNonce: ${nonce}\nOnly sign this message if you requested to link this wallet.`;
export function verifyWalletSignature(address,message,signature){
  try {const key=bs58.decode(address);let sig;
    try{sig=bs58.decode(signature)}catch{sig=null}
    if(sig?.length!==64&&typeof signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(signature))sig=Buffer.from(signature,'base64');
    return key.length===32&&sig?.length===64&&nacl.sign.detached.verify(new TextEncoder().encode(message),sig,key)
  }catch{return false}
}
export class RpcError extends Error {constructor(message,status=503){super(message);this.status=status}}
async function rpc(url,method,params,fetchImpl){
  const response=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new RpcError('Solana RPC unavailable');
  const json=await response.json();
  if(json.error||!json.result)throw new RpcError('Solana RPC unavailable');
  return json.result;
}
/** Exact mint holdings. RPC failure or missing mint is never interpreted as zero/eligible. */
export async function tokenHoldings(owner,url,fetchImpl=fetch){
  if(!url)throw new RpcError('Solana RPC not configured');
  if(!validAddress(owner))throw new RpcError('Invalid wallet address',400);
  let mintInfo;
  try{mintInfo=await rpc(url,'getAccountInfo',[MINT,{encoding:'base64',commitment:'confirmed'}],fetchImpl)}catch(e){if(e instanceof RpcError)throw e;throw new RpcError('Solana RPC unavailable')}
  if(!mintInfo.value||![TOKEN,TOKEN_2022].includes(mintInfo.value.owner))throw new RpcError('Token mint unavailable');
  const supply=await rpc(url,'getTokenSupply',[MINT,{commitment:'confirmed'}],fetchImpl);
  const decimals=supply.value?.decimals;
  if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw new RpcError('Token decimals unavailable');
  let amount=0n;
  for(const programId of [TOKEN,TOKEN_2022]){
    const result=await rpc(url,'getTokenAccountsByOwner',[owner,{programId},{encoding:'jsonParsed',commitment:'confirmed'}],fetchImpl);
    if(!Array.isArray(result.value))throw new RpcError('Token accounts unavailable');
    for(const item of result.value){
      const info=item.account?.data?.parsed?.info;
      if(item.account?.owner!==programId||info?.mint!==MINT||info.owner!==owner)continue;
      if(info.state==='frozen')continue;
      const token=info.tokenAmount;
      if(!token||token.decimals!==decimals||!/^\d+$/.test(token.amount))throw new RpcError('Malformed token account');
      amount+=BigInt(token.amount);
    }
  }
  return {rawAmount:amount.toString(),decimals,mint:MINT};
}
/** 1 credit per 1,000 *whole* tokens held; rechecked before every generation. */
export function creditsFor(rawAmount,decimals){
  const n=BigInt(rawAmount)/(1000n*10n**BigInt(decimals));
  return Number(n>BigInt(Number.MAX_SAFE_INTEGER)?BigInt(Number.MAX_SAFE_INTEGER):n);
}
