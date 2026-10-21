import bs58 from 'bs58';
import { MINT } from './wallet.mjs';

/** Confirmed token-balance changes from an exact-mint Yellowstone transaction. Not a trade classifier. */
export function normalizeActivity(update) {
  const txn=update.transaction?.transaction;
  if(!txn?.signature?.length || txn.meta?.err) return null;
  const totals=(balances)=>{
    const map=new Map();
    for(const b of balances||[]) {
      if(b.mint!==MINT || !b.owner || !/^\d+$/.test(b.uiTokenAmount?.amount||''))continue;
      map.set(b.owner,(map.get(b.owner)||0n)+BigInt(b.uiTokenAmount.amount));
    }
    return map;
  };
  const before=totals(txn.meta?.preTokenBalances),after=totals(txn.meta?.postTokenBalances);
  const changes=[];
  for(const owner of new Set([...before.keys(),...after.keys()])) {
    const delta=(after.get(owner)||0n)-(before.get(owner)||0n);
    if(delta!==0n)changes.push({owner,raw_delta:delta.toString()});
  }
  if(!changes.length)return null;
  return {signature:bs58.encode(txn.signature),slot:String(update.transaction.slot),mint:MINT,changes};
}
