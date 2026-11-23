import {createHmac,timingSafeEqual} from 'node:crypto';

export const courseAssetPath='/api/v1/course-assets/';

export function signCourseAssetAccess({assetId,expires,secret}){
  if(typeof assetId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(assetId))throw Error('素材编号无效');
  if(!Number.isSafeInteger(expires)||expires<1)throw Error('素材授权期限无效');
  if(typeof secret!=='string'||secret.length<16)throw Error('素材签名密钥无效');
  return createHmac('sha256',secret).update(`${assetId}\n${expires}`).digest('base64url');
}

export function verifyCourseAssetAccess({assetId,expires,signature,secret,now=Math.floor(Date.now()/1000)}){
  try{
    if(!Number.isSafeInteger(expires)||expires<now||expires>now+2*60*60)return false;
    if(typeof signature!=='string'||!/^[a-zA-Z0-9_-]{43}$/.test(signature))return false;
    const expected=signCourseAssetAccess({assetId,expires,secret});
    return timingSafeEqual(Buffer.from(signature),Buffer.from(expected));
  }catch{return false;}
}

export function signedCourseAssetUrl(value,{publicOrigin,secret,expires}){
  if(!value)return value;
  let target;
  try{target=new URL(String(value),publicOrigin);}catch{return value;}
  const match=target.pathname.match(/^\/api\/v1\/course-assets\/([a-zA-Z0-9-]{8,80})$/);
  if(!match)return value;
  target.searchParams.set('expires',String(expires));
  target.searchParams.set('signature',signCourseAssetAccess({assetId:match[1],expires,secret}));
  return target.href;
}
