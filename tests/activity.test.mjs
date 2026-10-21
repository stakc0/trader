import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeActivity } from '../server/activity.mjs';
import { MINT } from '../server/wallet.mjs';
const sig=Uint8Array.from({length:64},(_,i)=>i+1);
const balance=(owner,amount,mint=MINT)=>({owner,mint,uiTokenAmount:{amount}});
test('Yellowstone normalizer records only exact-mint confirmed changes',()=>{
 const x=normalizeActivity({transaction:{slot:'123',transaction:{signature:sig,meta:{err:null,preTokenBalances:[balance('alice','10'),balance('bob','7','OtherMint')],postTokenBalances:[balance('alice','15'),balance('bob','9','OtherMint')]}}}});
 assert.equal(x.slot,'123');assert.equal(x.mint,MINT);assert.deepEqual(x.changes,[{owner:'alice',raw_delta:'5'}]);assert.equal(typeof x.signature,'string');
});
test('Yellowstone normalizer ignores failed and irrelevant transactions',()=>{
 assert.equal(normalizeActivity({transaction:{slot:'3',transaction:{signature:sig,meta:{err:'failed',postTokenBalances:[balance('alice','10')]}}}}),null);
 assert.equal(normalizeActivity({transaction:{slot:'3',transaction:{signature:sig,meta:{err:null,postTokenBalances:[balance('alice','10','OtherMint')]}}}}),null);
});
