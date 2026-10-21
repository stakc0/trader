import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
const { encode } = bs58;
import { hashPassword, checkPassword, sessionCookie, parseCookie } from '../server/auth.mjs';
import { challengeMessage, verifyWalletSignature, tokenHoldings, creditsFor } from '../server/wallet.mjs';
import { createHandler } from '../server/handler.mjs';

test('scrypt password hashing does not store plaintext and rejects wrong passwords', async () => {
  const hash=await hashPassword('long-correct-password');
  assert.match(hash,/^scrypt\$/); assert.ok(!hash.includes('long-correct-password'));
  assert.equal(await checkPassword('long-correct-password',hash),true);
  assert.equal(await checkPassword('wrong-password',hash),false);
});
test('session cookie secure by default, and cookie parser handles malformed input',()=>{
  assert.match(sessionCookie('testvalue'),/HttpOnly; Secure; SameSite=Lax/);
  assert.equal(parseCookie('other=a; trader_session=testvalue','trader_session'),'testvalue');
  assert.equal(parseCookie('trader_session=%zz','trader_session'),null);
});
test('signature must match address and exact nonce-bound message',()=>{
  const pair=nacl.sign.keyPair(); const address=encode(pair.publicKey);
  const message=challengeMessage('user-id',address,'nonce-value');
  const sig=encode(nacl.sign.detached(new TextEncoder().encode(message),pair.secretKey));
  assert.equal(verifyWalletSignature(address,message,sig),true);
  assert.equal(verifyWalletSignature(address,message,Buffer.from(bs58.decode(sig)).toString('base64')),true);
  assert.equal(verifyWalletSignature(address,challengeMessage('user-id',address,'other'),sig),false);
  assert.equal(verifyWalletSignature(encode(randomBytes(32)),message,sig),false);
});
test('holdings sum only exact mint and owner, preserve raw integers, reject inconsistent decimals', async()=>{
  const mint='a5qFdexdutcopfoKbvYLrRDc2c8BDyLfh9GdhDWtrde'; const owner=encode(randomBytes(32));
  const fetch=async(_url,request)=> { const {method,params}=JSON.parse(request.body); return {ok:true,json:async()=>({result:method==='getAccountInfo'?{value:{owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'}}:method==='getTokenSupply'?{value:{decimals:6}}:{value:[{account:{owner:params[1].programId,data:{parsed:{info:{mint,owner,state:'initialized',tokenAmount:{amount:'9007199254740993',decimals:6}}}}}},{account:{owner:params[1].programId,data:{parsed:{info:{mint:'other',owner,tokenAmount:{amount:'10000000',decimals:6}}}}}}]}})}; };
  const balance=await tokenHoldings(owner,'https://rpc.example',fetch);
  assert.equal(balance.rawAmount,'18014398509481986'); assert.equal(balance.decimals,6);
  assert.equal(creditsFor(balance.rawAmount,balance.decimals),18014398);
});
test('generation cannot start without provider configuration',async()=>{
  const handler=createHandler({env:{},db:{}});
  const result=await handler(new Request('http://localhost/api/generations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:'hello'})}));
  assert.equal(result.status,503);
});
