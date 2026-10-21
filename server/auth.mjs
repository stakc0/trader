import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt=promisify(scryptCallback);
export const sessionHash = token=>createHash('sha256').update(token).digest('hex');
export const newSessionToken = ()=>randomBytes(32).toString('base64url');
export async function hashPassword(password){
  const salt=randomBytes(16).toString('hex');
  const hash=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  return `scrypt$${salt}$${hash.toString('hex')}`;
}
export async function checkPassword(password,stored){
  if(typeof stored!=='string'||!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(stored))return false;
  const [,salt,expectedHex]=stored.split('$'); const expected=Buffer.from(expectedHex,'hex');
  const actual=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  return timingSafeEqual(expected,actual);
}
export function sessionCookie(token,{secure=true,maxAge=604800}={}){
  return `trader_session=${token}; Path=/; HttpOnly; ${secure?'Secure; ':''}SameSite=Lax; Max-Age=${maxAge}`;
}
export function parseCookie(header,name){
  if(!header)return null;
  for(const part of header.split(';')){const [key,...value]=part.trim().split('=');if(key===name){try{return decodeURIComponent(value.join('='))}catch{return null}}}
  return null;
}
