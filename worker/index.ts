import bcrypt from "bcryptjs";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PIN_HASH: string;
  RECEIPTS_BUCKET?: any;
  PAYMENT_QR_URL?: string;
}
const USER_COOKIE="spiel_user_session";
const ADMIN_COOKIE="spiel_admin_session";
const FREE_COPY_LIMIT=300;
const PLAN_PRICE=49;
const PLAN_DAYS=30;
const SESSION_SECONDS=60*60*24*30;
const json=(data:unknown,status=200,headers:HeadersInit={})=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers}});
const err=(message:string,status=400)=>json({error:message},status);
const nowSec=()=>Math.floor(Date.now()/1000);
const monthKey=()=>new Date().toISOString().slice(0,7);
async function hash(value:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
function cookie(request:Request,name:string){const s=request.headers.get("Cookie")||"";const v=s.split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="));return v?decodeURIComponent(v.slice(name.length+1)):null;}
function setCookie(name:string,value:string,maxAge:number){return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;}
function clearCookie(name:string){return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;}
function sameOrigin(req:Request){const origin=req.headers.get("Origin");if(!origin)return false;try{return new URL(origin).host===new URL(req.url).host;}catch{return false;}}
async function userId(req:Request,env:Env):Promise<string|null>{
 const token=cookie(req,USER_COOKIE);if(!token)return null;
 const row=await env.DB.prepare("SELECT user_id FROM user_sessions WHERE token_hash=? AND expires_at>?").bind(await hash(token),nowSec()).first<{user_id:string}>();
 return row?.user_id||null;
}
async function adminOk(req:Request,env:Env){const token=cookie(req,ADMIN_COOKIE);if(!token)return false;return !!await env.DB.prepare("SELECT token_hash FROM admin_sessions WHERE token_hash=? AND expires_at>?").bind(await hash(token),nowSec()).first();}
async function createSession(env:Env,table:"user_sessions"|"admin_sessions",ownerColumn:"user_id"|null,owner:string|null){
 const token=crypto.randomUUID()+crypto.randomUUID().replaceAll("-","");
 const tokenHash=await hash(token),now=nowSec(),expires=now+SESSION_SECONDS;
 if(table==="user_sessions") await env.DB.prepare("INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(tokenHash,owner,expires,now).run();
 else await env.DB.prepare("INSERT INTO admin_sessions(token_hash,expires_at,created_at) VALUES(?,?,?)").bind(tokenHash,expires,now).run();
 return token;
}
async function usage(env:Env,id:string){
 const row=await env.DB.prepare("SELECT copies FROM copy_usage WHERE user_id=? AND period=?").bind(id,monthKey()).first<{copies:number}>();
 const sub=await env.DB.prepare("SELECT expires_at FROM subscriptions WHERE user_id=? AND status='ACTIVE' ORDER BY expires_at DESC LIMIT 1").bind(id).first<{expires_at:number}>();
 const premium=!!sub&&sub.expires_at>nowSec();
 return {plan:premium?"PREMIUM":"FREE",copiesUsed:Number(row?.copies||0),copyLimit:premium?null:FREE_COPY_LIMIT,copiesRemaining:premium?null:Math.max(0,FREE_COPY_LIMIT-Number(row?.copies||0)),period:monthKey(),subscriptionExpiresAt:premium?sub!.expires_at:null,price:PLAN_PRICE,currency:"PHP"};
}
async function currentUser(req:Request,env:Env){
 const id=await userId(req,env);if(!id)return null;
 const u=await env.DB.prepare("SELECT id,email,created_at FROM users WHERE id=? AND status='ACTIVE'").bind(id).first<{id:string,email:string,created_at:string}>();
 if(!u)return null;
 return {...u,usage:await usage(env,id)};
}
function validEmail(v:unknown):v is string{return typeof v==="string"&&v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);}
function validPassword(v:unknown):v is string{return typeof v==="string"&&v.length>=10&&v.length<=128;}
async function api(req:Request,env:Env):Promise<Response>{
 const url=new URL(req.url),p=url.pathname,m=req.method;
 if(p==="/api/health"&&m==="GET")return json({ok:true,storage:"cloudflare-d1",subscriptions:true,manualPayments:true});
 if(p==="/api/time"&&m==="GET"){
  const zone=url.searchParams.get("timeZone")||"";
  if(!/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(zone))return err("Valid IANA time zone required.");
  try{
   const r=await fetch("https://timeapi.io/api/Time/current/zone?timeZone=UTC",{signal:AbortSignal.timeout(8000)});
   if(!r.ok)throw new Error("Primary time service failed");
   const d=await r.json() as {dateTime?:string};const epochMs=Date.parse(`${(d.dateTime||"").replace(/(\.\d{3})\d+$/,"$1")}Z`);
   if(!Number.isFinite(epochMs))throw new Error("Invalid time response");
   return json({epochMs,source:"TimeAPI.io"});
  }catch{
   try{const r=await fetch(`https://gateway.timeapi.world/timezone/${encodeURIComponent(zone)}`,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error();const d=await r.json() as {unixtime?:number};if(typeof d.unixtime!=="number")throw new Error();return json({epochMs:d.unixtime*1000,source:"TimeAPI World"});}
   catch{return err("Online time providers are unavailable. Computer time was not used.",503);}
  }
 }
 if(p==="/api/templates"&&m==="GET"){const rows=await env.DB.prepare("SELECT id,name FROM spiel_templates WHERE active=1 ORDER BY CAST(id AS INTEGER),id").all();return json({templates:rows.results||[]});}
 const publicTemplate=p.match(/^\/api\/templates\/([^/]+)$/);
 if(publicTemplate&&m==="GET"){const row=await env.DB.prepare("SELECT id,name,spiel,active FROM spiel_templates WHERE id=? AND active=1").bind(decodeURIComponent(publicTemplate[1])).first();return row?json({template:row}):err("Spiel not found.",404);}

 if(p==="/api/auth/register"&&m==="POST"){
  let b:any;try{b=await req.json();}catch{return err("Invalid request body.");}
  const email=validEmail(b.email)?b.email.trim().toLowerCase():"";
  if(!email||!validPassword(b.password))return err("Enter a valid email and a password with at least 10 characters.");
  const exists=await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
  if(exists)return err("An account with this email already exists.",409);
  const id=crypto.randomUUID(),passwordHash=await bcrypt.hash(b.password,10),now=new Date().toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,password_hash,status,created_at) VALUES(?,?,?,'ACTIVE',?)").bind(id,email,passwordHash,now).run();
  const token=await createSession(env,"user_sessions","user_id",id);
  return json({user:await currentUser(new Request(req.url,{headers:{"Cookie":`${USER_COOKIE}=${token}`}}),env)},201,{"Set-Cookie":setCookie(USER_COOKIE,token,SESSION_SECONDS)});
 }
 if(p==="/api/auth/login"&&m==="POST"){
  let b:any;try{b=await req.json();}catch{return err("Invalid request body.");}
  const email=validEmail(b.email)?b.email.trim().toLowerCase():"";
  const row=await env.DB.prepare("SELECT id,email,password_hash,status FROM users WHERE email=?").bind(email).first<any>();
  if(!row||row.status!=="ACTIVE"||typeof b.password!=="string"||!(await bcrypt.compare(b.password,row.password_hash)))return err("Incorrect email or password.",401);
  const token=await createSession(env,"user_sessions","user_id",row.id);
  return json({user:await currentUser(new Request(req.url,{headers:{"Cookie":`${USER_COOKIE}=${token}`}}),env)},200,{"Set-Cookie":setCookie(USER_COOKIE,token,SESSION_SECONDS)});
 }
 if(p==="/api/auth/me"&&m==="GET"){const u=await currentUser(req,env);return u?json({user:u}):err("Please sign in to continue.",401);}
 if(p==="/api/auth/logout"&&m==="POST"){
  const token=cookie(req,USER_COOKIE);if(token)await env.DB.prepare("DELETE FROM user_sessions WHERE token_hash=?").bind(await hash(token)).run();
  return json({ok:true},200,{"Set-Cookie":clearCookie(USER_COOKIE)});
 }
 if(p==="/api/usage/copy"&&m==="POST"){
  const id=await userId(req,env);if(!id)return err("Sign in is required before copying.",401);
  const current=await usage(env,id);
  if(current.plan!=="PREMIUM"&&current.copiesUsed>=FREE_COPY_LIMIT)return json({error:"You have reached your 300-copy monthly free limit. Upgrade to Premium to continue.",usage:current},402);
  const period=monthKey();
  // Atomic monthly increment prevents simultaneous requests from exceeding the free allowance.
  if(current.plan==="PREMIUM"){
   await env.DB.prepare("INSERT INTO copy_usage(user_id,period,copies) VALUES(?,?,1) ON CONFLICT(user_id,period) DO UPDATE SET copies=copies+1").bind(id,period).run();
  }else{
   const result=await env.DB.prepare("INSERT INTO copy_usage(user_id,period,copies) VALUES(?,?,1) ON CONFLICT(user_id,period) DO UPDATE SET copies=copies+1 WHERE copies < ?").bind(id,period,FREE_COPY_LIMIT).run();
   if(!result.meta.changes)return json({error:"You have reached your 300-copy monthly free limit. Upgrade to Premium to continue.",usage:await usage(env,id)},402);
  }
  return json({usage:await usage(env,id)});
 }
 if(p==="/api/subscription/payment"&&m==="POST"){
  const id=await userId(req,env);if(!id)return err("Sign in to continue.",401);
  let b:any;try{b=await req.json();}catch{return err("Invalid request body.");}
  const reference=typeof b.reference==="string"?b.reference.trim():"";
  const paidAt=typeof b.paidAt==="string"?b.paidAt.trim():"";
  const receipt=typeof b.receiptData==="string"?b.receiptData:"";
  const mime=typeof b.receiptMime==="string"?b.receiptMime:"";
  if(reference.length<6||reference.length>100)return err("Enter a valid GCash transaction reference.");
  if(!/^image\/(png|jpeg|webp)$/.test(mime))return err("Receipt must be PNG, JPG or WebP.");
  if(!receipt.startsWith("data:"+mime+";base64,"))return err("Invalid receipt image.");
  const encoded=receipt.split(",",2)[1]||"";
  if(encoded.length>7_000_000)return err("Receipt must be 5 MB or smaller.");
  if(!env.RECEIPTS_BUCKET)return err("Receipt storage is not configured. Contact the administrator.",503);
  const duplicate=await env.DB.prepare("SELECT id FROM manual_payment_submissions WHERE payment_reference=?").bind(reference).first();
  if(duplicate)return err("This payment reference has already been submitted.",409);
  const raw=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  const key=`receipts/${id}/${crypto.randomUUID()}.${mime.split('/')[1].replace('jpeg','jpg')}`;
  await env.RECEIPTS_BUCKET.put(key,raw,{httpMetadata:{contentType:mime}});
  const paymentId=crypto.randomUUID(),now=nowSec();
  try{
   await env.DB.prepare("INSERT INTO manual_payment_submissions(id,user_id,amount,currency,payment_reference,paid_at,receipt_key,status,submitted_at) VALUES(?,?,49,'PHP',?,?,?,'PENDING',?)").bind(paymentId,id,reference,paidAt||null,key,now).run();
  }catch(e){await env.RECEIPTS_BUCKET.delete(key);throw e;}
  return json({submitted:true,paymentId,status:"PENDING"},201);
 }
 if(p==="/api/subscription/payments"&&m==="GET"){
  const id=await userId(req,env);if(!id)return err("Sign in to continue.",401);
  const rows=await env.DB.prepare("SELECT id,amount,currency,payment_reference,status,submitted_at,reviewed_at,rejection_reason FROM manual_payment_submissions WHERE user_id=? ORDER BY submitted_at DESC LIMIT 20").bind(id).all();
  return json({payments:rows.results||[],usage:await usage(env,id),qrUrl:env.PAYMENT_QR_URL||"/payment/gcash-qr-placeholder.png"});
 }
 if(p==="/api/subscription/status"&&m==="GET"){
  const id=await userId(req,env);if(!id)return err("Sign in to continue.",401);
  return json({usage:await usage(env,id)});
 }
 if(p.startsWith("/api/admin/")&&["POST","PUT","DELETE"].includes(m)&&!sameOrigin(req))return err("Cross-origin admin request rejected.",403);
 if(p==="/api/admin/login"&&m==="POST"){
  let b:any;try{b=await req.json();}catch{return err("Invalid request body.");}
  const pin=typeof b.pin==="string"?b.pin:"";
  if(!env.ADMIN_PIN_HASH||pin.length<8||pin.length>128||!(await bcrypt.compare(pin,env.ADMIN_PIN_HASH)))return err("Incorrect PIN.",401);
  const token=await createSession(env,"admin_sessions",null,null);
  return json({authenticated:true},200,{"Set-Cookie":setCookie(ADMIN_COOKIE,token,SESSION_SECONDS)});
 }
 if(p==="/api/admin/logout"&&m==="POST"){const t=cookie(req,ADMIN_COOKIE);if(t)await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await hash(t)).run();return json({authenticated:false},200,{"Set-Cookie":clearCookie(ADMIN_COOKIE)});}
 if(p==="/api/admin/session"&&m==="GET")return await adminOk(req,env)?json({authenticated:true}):err("Administrator authentication required.",401);
 if(p==="/api/admin/payments"&&m==="GET"){
  if(!await adminOk(req,env))return err("Administrator authentication required.",401);
  const rows=await env.DB.prepare("SELECT p.id,p.user_id,u.email,p.amount,p.currency,p.payment_reference,p.paid_at,p.receipt_key,p.status,p.submitted_at,p.reviewed_at,p.rejection_reason FROM manual_payment_submissions p JOIN users u ON u.id=p.user_id ORDER BY CASE p.status WHEN 'PENDING' THEN 0 ELSE 1 END,p.submitted_at DESC LIMIT 100").all();
  return json({payments:rows.results||[]});
 }
 const receiptMatch=p.match(/^\/api\/admin\/payments\/([^/]+)\/receipt$/);
 if(receiptMatch&&m==="GET"){
  if(!await adminOk(req,env))return err("Administrator authentication required.",401);
  if(!env.RECEIPTS_BUCKET)return err("Receipt storage is not configured.",503);
  const row=await env.DB.prepare("SELECT receipt_key FROM manual_payment_submissions WHERE id=?").bind(decodeURIComponent(receiptMatch[1])).first<{receipt_key:string}>();
  if(!row)return err("Payment not found.",404);
  const obj=await env.RECEIPTS_BUCKET.get(row.receipt_key);if(!obj)return err("Receipt not found.",404);
  const headers=new Headers();obj.writeHttpMetadata(headers);headers.set("Cache-Control","no-store");headers.set("Content-Disposition","inline");return new Response(obj.body,{headers});
 }
 const paymentReview=p.match(/^\/api\/admin\/payments\/([^/]+)\/(approve|reject)$/);
 if(paymentReview&&(m==="POST")){
  if(!await adminOk(req,env))return err("Administrator authentication required.",401);
  const paymentId=decodeURIComponent(paymentReview[1]),decision=paymentReview[2];let b:any={};try{b=await req.json();}catch{return err("Invalid request body.");}
  const row=await env.DB.prepare("SELECT id,user_id,payment_reference,status,amount FROM manual_payment_submissions WHERE id=?").bind(paymentId).first<any>();
  if(!row)return err("Payment not found.",404);if(row.status!=="PENDING")return err("This payment has already been reviewed.",409);
  const now=nowSec();
  if(decision==="reject"){
   const reason=typeof b.reason==="string"?b.reason.trim().slice(0,500):"Payment could not be verified.";
   await env.DB.prepare("UPDATE manual_payment_submissions SET status='REJECTED',reviewed_at=?,reviewed_by='admin',rejection_reason=? WHERE id=? AND status='PENDING'").bind(now,reason,paymentId).run();
   return json({status:"REJECTED"});
  }
  if(Number(row.amount)!==49)return err("Payment amount does not match the ₱49 plan.",409);
  const expiry=await env.DB.prepare("SELECT MAX(expires_at) AS expiry FROM subscriptions WHERE user_id=? AND status='ACTIVE'").bind(row.user_id).first<any>();
  const start=Math.max(now,Number(expiry?.expiry||0)),expires=start+30*86400;
  const reviewed=await env.DB.prepare("UPDATE manual_payment_submissions SET status='APPROVED',reviewed_at=?,reviewed_by='admin' WHERE id=? AND status='PENDING'").bind(now,paymentId).run();
  if(!reviewed.meta.changes)return err("This payment has already been reviewed.",409);
  await env.DB.prepare("INSERT INTO subscriptions(id,user_id,plan,status,starts_at,expires_at,payment_reference,created_at) VALUES(?,?,'PREMIUM','ACTIVE',?,?,?,?)").bind(crypto.randomUUID(),row.user_id,start,expires,row.payment_reference,now).run();
  return json({status:"APPROVED",startsAt:start,expiresAt:expires});
 }

 if(p==="/api/admin/templates"&&m==="GET"){
  if(!await adminOk(req,env))return err("Administrator authentication required.",401);
  const rows=await env.DB.prepare("SELECT id,name,spiel,active FROM spiel_templates ORDER BY CAST(id AS INTEGER),id").all();
  return json({templates:(rows.results||[]).map((r:any)=>({...r,active:!!r.active}))});
 }
 if(p==="/api/admin/templates"&&m==="POST"){
  if(!await adminOk(req,env))return err("Administrator authentication required.",401);
  let b:any;try{b=await req.json();}catch{return err("Invalid request body.");}
  const name=typeof b.name==="string"?b.name.trim():"",spiel=typeof b.spiel==="string"?b.spiel.trim():"";
  if(!name||name.length>120||!spiel||spiel.length>10000||!spiel.includes("{{TIME}}")||typeof b.active!=="boolean")return err("Enter a valid name and spiel containing {{TIME}}.");
  const max=await env.DB.prepare("SELECT MAX(CAST(id AS INTEGER)) AS max_id FROM spiel_templates").first<any>(),id=String(Number(max?.max_id||0)+1);
  await env.DB.prepare("INSERT INTO spiel_templates(id,name,spiel,active) VALUES(?,?,?,?)").bind(id,name,spiel,b.active?1:0).run();
  return json({template:{id,name,spiel,active:b.active}},201);
 }
 const adminMatch=p.match(/^\/api\/admin\/templates\/([^/]+)$/);
 if(adminMatch&&m==="PUT"){
  if(!await adminOk(req,env))return err("Administrator authentication required.",401);
  let b:any;try{b=await req.json();}catch{return err("Invalid request body.");}
  const name=typeof b.name==="string"?b.name.trim():"",spiel=typeof b.spiel==="string"?b.spiel.trim():"";
  if(!name||name.length>120||!spiel||spiel.length>10000||!spiel.includes("{{TIME}}")||typeof b.active!=="boolean")return err("Enter a valid name and spiel containing {{TIME}}.");
  const id=decodeURIComponent(adminMatch[1]),r=await env.DB.prepare("UPDATE spiel_templates SET name=?,spiel=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(name,spiel,b.active?1:0,id).run();
  return r.meta.changes?json({template:{id,name,spiel,active:b.active}}):err("Template not found.",404);
 }
 if(adminMatch&&m==="DELETE"){
  if(!await adminOk(req,env))return err("Administrator authentication required.",401);
  const r=await env.DB.prepare("DELETE FROM spiel_templates WHERE id=?").bind(decodeURIComponent(adminMatch[1])).run();
  return r.meta.changes?json({deleted:true}):err("Template not found.",404);
 }
 return err("Not found.",404);
}
export default {async fetch(req:Request,env:Env):Promise<Response>{
 const u=new URL(req.url);
 if(u.pathname.startsWith("/api/")){
  try{return await api(req,env);}catch(e){console.error("Worker API error",e);return err("An unexpected server error occurred.",500);}
 }
 return env.ASSETS.fetch(req);
}};
