const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),url=require('url');
const PORT=Number(process.env.PORT||3000), ROOT=__dirname, DATA_DIR=process.env.DATA_DIR||path.join(ROOT,'data'), UPLOADS=path.join(DATA_DIR,'uploads');
let pgPool=null, pgReady=false, persistQueue=Promise.resolve();
if(process.env.DATABASE_URL){try{const {Pool}=require('pg');pgPool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false}})}catch(e){console.error('PostgreSQL driver unavailable:',e.message)}}
fs.mkdirSync(UPLOADS,{recursive:true});
const DB=path.join(DATA_DIR,'db.json');
let db={users:[],sessions:[],products:[],orders:[],listings:[],bookings:[],images:{},next:{user:1,product:1,listing:1,order:1,booking:1}};
try{if(fs.existsSync(DB)){const x=JSON.parse(fs.readFileSync(DB,'utf8'));db={...db,...x,images:{...(x.images||{})},next:{...db.next,...(x.next||{})}}}}catch(e){console.error('DB read error',e)}
function save(){const payload=JSON.stringify(db,null,2);try{fs.writeFileSync(DB,payload)}catch(e){console.error('Local database save failed:',e.message)}if(pgPool&&pgReady){const snapshot=JSON.parse(payload);persistQueue=persistQueue.then(()=>pgPool.query('INSERT INTO csz_app_state(id,payload,updated_at) VALUES(1,$1::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()',[JSON.stringify(snapshot)])).catch(e=>console.error('PostgreSQL save failed:',e.message))}} function json(res,s,o){const b=JSON.stringify(o);res.writeHead(s,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'});res.end(b)}
function text(res,s,b,t='text/html; charset=utf-8'){res.writeHead(s,{'Content-Type':t,'Cache-Control':'no-store'});res.end(b)}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>10*1024*1024){reject(new Error('Payload too large'));req.destroy()}});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});req.on('error',reject)})}
function hash(p,s=crypto.randomBytes(16).toString('hex')){return {salt:s,hash:crypto.scryptSync(String(p),s,64).toString('hex')}} function verify(p,x){try{return crypto.timingSafeEqual(Buffer.from(hash(p,x.salt).hash,'hex'),Buffer.from(x.hash,'hex'))}catch{return false}} function token(){return crypto.randomBytes(32).toString('hex')}
function safe(u){const x={...u};delete x.password;return x} function auth(req){const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return null;const s=db.sessions.find(x=>x.token===h.slice(7));return s?db.users.find(u=>u.id===s.userId)||null:null}
function admin(req){const me=auth(req);return me&&me.role==='Admin'?me:null}
function mime(f){return {'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'}[path.extname(f).toLowerCase()]||'application/octet-stream'}
// Shared per-server-instance AI answer cache: avoids repeated API calls for identical questions.
const AI_CACHE_TTL_MS=Math.max(60_000,Number(process.env.AI_CACHE_TTL_MS)||24*60*60*1000);
const AI_CACHE_MAX=Math.max(50,Number(process.env.AI_CACHE_MAX)||500);
const aiAnswerCache=new Map();
const aiInFlight=new Map();
function aiCacheKey(q){return crypto.createHash('sha256').update(String(q).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase()).digest('hex')}
function trimAiCache(){const now=Date.now();for(const [k,v] of aiAnswerCache){if(v.expiresAt<=now)aiAnswerCache.delete(k)}while(aiAnswerCache.size>AI_CACHE_MAX){const first=aiAnswerCache.keys().next().value;if(first===undefined)break;aiAnswerCache.delete(first)}}
async function ai(q){const question=String(q).trim();if(!question)throw new Error('कृपया अपना सवाल लिखें।');trimAiCache();const cacheKey=aiCacheKey(question),cached=aiAnswerCache.get(cacheKey);if(cached&&cached.expiresAt>Date.now()){aiAnswerCache.delete(cacheKey);aiAnswerCache.set(cacheKey,cached);return cached.answer}if(aiInFlight.has(cacheKey))return aiInFlight.get(cacheKey);const task=aiUncached(question).then(answer=>{aiAnswerCache.set(cacheKey,{answer,expiresAt:Date.now()+AI_CACHE_TTL_MS});trimAiCache();return answer}).finally(()=>aiInFlight.delete(cacheKey));aiInFlight.set(cacheKey,task);return task}
async function aiUncached(q){
 const systemText='You are Nirvix Ai AI assistant. Answer construction, civil engineering, house planning, material, RCC, room, transportation and general questions clearly. Reply in the language used by the user. For structural safety, advise verification by a qualified engineer.';
 // Prefer Gemini when GEMINI_API_KEY is configured. Keep OpenAI as a compatible fallback.
 const geminiKey=String(process.env.GEMINI_API_KEY||'').trim();
 if(geminiKey){
  const model=String(process.env.GEMINI_MODEL||'gemini-2.5-flash').trim();
  let r,j;
  try{
   r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent?key='+encodeURIComponent(geminiKey),{
    method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),
    body:JSON.stringify({systemInstruction:{parts:[{text:systemText}]},contents:[{role:'user',parts:[{text:String(q)}]}],generationConfig:{maxOutputTokens:2048,temperature:0.4}})
   });
   j=await r.json().catch(()=>({}));
  }catch(e){console.error('Gemini request connection error:',e&&e.message?e.message:e);throw new Error('AI सेवा से कनेक्शन नहीं हो पाया। कुछ समय बाद दोबारा प्रयास करें।')}
  if(!r.ok){
   const msg=String(j?.error?.message||'').trim();console.error('Gemini API error:',r.status,msg);
   if(r.status===400)throw new Error('Gemini request स्वीकार नहीं हुई। GEMINI_MODEL और request settings जाँचें।');
   if(r.status===401||r.status===403)throw new Error('GEMINI_API_KEY गलत है या API access उपलब्ध नहीं है। Server Environment में key जाँचें।');
   if(r.status===429)throw new Error('Gemini API की rate limit या quota पूरी है। Google AI Studio में quota जाँचें।');
   throw new Error(msg||('Gemini API request failed ('+r.status+').'));
  }
  const answer=(j?.candidates?.[0]?.content?.parts||[]).map(x=>x.text||'').join('').trim();
  if(!answer)throw new Error('Gemini से जवाब नहीं मिला। कृपया सवाल बदलकर दोबारा पूछें।');
  return answer;
 }
 const key=String(process.env.OPENAI_API_KEY||'').trim();
 if(!key)throw new Error('AI_KEY_NOT_CONFIGURED');
 const model=String(process.env.OPENAI_MODEL||'gpt-4.1-mini').trim();
 let r,j;
 try{
  r=await fetch('https://api.openai.com/v1/chat/completions',{
   method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
   signal:AbortSignal.timeout(30000),
   body:JSON.stringify({model,messages:[{role:'system',content:systemText},{role:'user',content:String(q)}],max_tokens:2048})
  });
  j=await r.json().catch(()=>({}));
 }catch(e){console.error('OpenAI request connection error:',e&&e.message?e.message:e);throw new Error('AI सेवा से कनेक्शन नहीं हो पाया। कुछ समय बाद दोबारा प्रयास करें।')}
 if(!r.ok){
  const apiMessage=String(j?.error?.message||'').trim(),errorCode=String(j?.error?.code||'').toLowerCase(),errorType=String(j?.error?.type||'').toLowerCase();
  console.error('OpenAI API error:',r.status,errorCode||errorType,apiMessage);
  if(r.status===401)throw new Error('OPENAI_API_KEY गलत, inactive या revoke की गई है। Server Environment में key जाँचें।');
  if(r.status===429)throw new Error(/quota|billing|credits/i.test(apiMessage)||errorCode.includes('insufficient_quota')?'OpenAI API की billing/credits quota पूरी है।':'OpenAI API rate limit लगी है। थोड़ी देर बाद दोबारा कोशिश करें।');
  if(r.status===400)throw new Error('OpenAI request स्वीकार नहीं हुई: '+(apiMessage||'model या request settings जाँचें।'));
  if(r.status===403)throw new Error('OpenAI API access अनुमति नहीं मिली। Project, model access और API key permissions जाँचें।');
  if(r.status===404)throw new Error('OpenAI endpoint या model नहीं मिला। OPENAI_MODEL जाँचें।');
  throw new Error(apiMessage||('OpenAI API request failed ('+r.status+').'));
 }
 const answer=String(j?.choices?.[0]?.message?.content||'').trim();
 if(!answer)throw new Error('OpenAI से खाली जवाब मिला। कृपया सवाल बदलकर दोबारा पूछें।');
 return answer;
}

const server=http.createServer(async(req,res)=>{try{const u=url.parse(req.url,true),p=u.pathname;if(req.method==='OPTIONS')return json(res,204,{});
if(p==='/api/health')return json(res,200,{ok:true,service:'Nirvix Ai V6',aiConfigured:Boolean(String(process.env.GEMINI_API_KEY||process.env.OPENAI_API_KEY||'').trim()),aiProvider:String(process.env.GEMINI_API_KEY||'').trim()?'Gemini':(String(process.env.OPENAI_API_KEY||'').trim()?'OpenAI':'none'),aiModel:String(process.env.GEMINI_API_KEY||'').trim()?(process.env.GEMINI_MODEL||'gemini-2.5-flash'):(process.env.OPENAI_MODEL||'gpt-4.1-mini'),databaseConfigured:Boolean(pgPool),databaseReady:pgReady,time:new Date().toISOString()});
if(p==='/api/auth/register'&&req.method==='POST'){const x=await body(req),role=['Customer','Seller','Provider'].includes(x.role)?x.role:'Customer',mobile=String(x.mobile||'').replace(/\D/g,''),email=String(x.email||'').trim().toLowerCase(),address=String(x.address||'').trim(),pincode=String(x.pincode||'').replace(/\D/g,'');if(String(x.name||'').trim().length<2||!/^[0-9]{10}$/.test(mobile)||!address)return json(res,400,{error:'Name, valid 10-digit mobile and full address required.'});if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json(res,400,{error:'Valid email ID डालें।'});if(pincode&&!/^[0-9]{6}$/.test(pincode))return json(res,400,{error:'PIN code must be 6 digits.'});if(!email&&!mobile)return json(res,400,{error:'Mobile or email is required.'});if(db.users.some(a=>a.mobile===mobile))return json(res,409,{error:'यह mobile number पहले से registered है। उसी role और password से login करें; दुबारा registration नहीं हो सकता।'});if(!/^\d{4}$/.test(String(x.password||'')))return json(res,400,{error:'4 अंकों का password जरूरी है।'});if(email&&db.users.some(a=>String(a.email||'').toLowerCase()===email&&a.role===role))return json(res,409,{error:'This email is already registered for this role.'});const referred=String(x.referralCode||'').trim().toUpperCase();const referrer=referred?db.users.find(a=>String(a.referralCode||'').toUpperCase()===referred):null;if(referred&&!referrer)return json(res,400,{error:'Referral ID नहीं मिला। सही Referral ID डालें या खाली छोड़ें।'});const u={id:db.next.user++,name:String(x.name).trim(),mobile,email,place:String(x.place||''),address,pincode,latitude:x.latitude?Number(x.latitude):null,longitude:x.longitude?Number(x.longitude):null,role,password:hash(String(x.password)),referralCode:'CSZ'+crypto.randomBytes(4).toString('hex').toUpperCase(),referredBy:referrer?referrer.referralCode:'',rewardCoupons:[],createdAt:new Date().toISOString()};db.users.push(u);if(referrer){referrer.rewardCoupons=Array.isArray(referrer.rewardCoupons)?referrer.rewardCoupons:[];referrer.rewardCoupons.push({code:'CSZ-'+crypto.randomBytes(3).toString('hex').toUpperCase(),reason:'Referral registration',createdAt:new Date().toISOString()})}const t=token();db.sessions.push({token:t,userId:u.id,createdAt:new Date().toISOString()});save();return json(res,200,{token:t,user:safe(u)})}
if(p==='/api/auth/login'&&req.method==='POST'){const x=await body(req),identifier=String(x.identifier||x.mobile||x.email||'').trim(),email=identifier.toLowerCase(),mobile=identifier.replace(/\D/g,''),byEmail=x.loginBy==='email'||identifier.includes('@');if(!identifier)return json(res,400,{error:'Registered mobile number or email is required.'});const matches=db.users.filter(a=>byEmail?String(a.email||'').trim().toLowerCase()===email:a.mobile===mobile);const requestedRole=['Customer','Seller','Provider'].includes(x.role)?x.role:'';if(!requestedRole)return json(res,400,{error:'Login के लिए Customer, Seller या Provider में से सही role चुनें।'});const u=matches.find(a=>a.role===requestedRole);if(!u){if(matches.length)return json(res,401,{error:'यह mobile/email दूसरे role में registered है ('+[...new Set(matches.map(a=>a.role))].join(', ')+')। उसी role को चुनें जिसमें registration किया था।'});return json(res,401,{error:byEmail?'इस Email/Gmail पर account नहीं मिला। Registration में इस्तेमाल किया गया सही Email ID डालें।':'इस mobile number पर account नहीं मिला। Registration वाला सही mobile number डालें।'});}if(!u.password||!verify(String(x.password||''),u.password))return json(res,401,{error:'गलत 4 अंकों का password। Registration वाला वही password डालें।'});const t=token();db.sessions.push({token:t,userId:u.id,createdAt:new Date().toISOString()});save();return json(res,200,{token:t,user:safe(u)})}
if(p==='/api/auth/admin'&&req.method==='POST'){const x=await body(req);const key=process.env.ADMIN_KEY||process.env.OWNER_KEY;if(!key)return json(res,503,{error:'Admin login disabled: set ADMIN_KEY (or existing OWNER_KEY) in Render Environment first.'});if(String(x.key||'')!==key)return json(res,401,{error:'Invalid owner key'});let u=db.users.find(a=>a.role==='Admin');if(!u){u={id:db.next.user++,name:'Ranjan Kumar',mobile:'',role:'Admin',password:hash(crypto.randomUUID()),createdAt:new Date().toISOString()};db.users.push(u)}const t=token();db.sessions.push({token:t,userId:u.id,createdAt:new Date().toISOString()});save();return json(res,200,{token:t,user:safe(u)})}
if(p==='/api/me'&&req.method==='GET'){const me=auth(req);return me?json(res,200,{user:safe(me)}):json(res,401,{error:'Login required'})}
if(p==='/api/profile'&&req.method==='PATCH'){const me=auth(req);if(!me)return json(res,401,{error:'Login required'});const x=await body(req);if(x.address)me.address=String(x.address).trim();if(x.place)me.place=String(x.place).trim();if(x.pincode!==undefined)me.pincode=String(x.pincode).replace(/\D/g,'').slice(0,6);if(x.latitude!==undefined)me.latitude=Number(x.latitude)||null;if(x.longitude!==undefined)me.longitude=Number(x.longitude)||null;save();return json(res,200,{user:safe(me)})}
if(p==='/api/products'&&req.method==='GET'){let a=db.products.filter(x=>x.stock>0),q=String(u.query.q||'').toLowerCase();if(u.query.seller==='me'){const me=auth(req);if(!me||me.role!=='Seller')return json(res,401,{error:'Seller login required'});a=a.filter(x=>x.sellerId===me.id)}if(q)a=a.filter(x=>(x.name+' '+x.category+' '+x.description).toLowerCase().includes(q));a=a.map(x=>({...x,sellerMobile:db.users.find(z=>z.id===x.sellerId&&z.role==='Seller')?.mobile||''}));return json(res,200,{products:a})}
if(p==='/api/seller/upload-image'&&req.method==='POST'){const me=auth(req);if(!me||me.role!=='Seller')return json(res,403,{error:'Seller login required'});const x=await body(req),m=String(x.dataUrl||'').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);if(!m)return json(res,400,{error:'Only JPG, PNG or WEBP image is allowed.'});const b=Buffer.from(m[2],'base64');if(b.length>4*1024*1024)return json(res,400,{error:'Image must be 4 MB or smaller.'});const ext=m[1].split('/')[1].replace('jpeg','jpg'),name=crypto.randomBytes(12).toString('hex')+'.'+ext;db.images=db.images||{};db.images[name]={type:m[1],data:String(x.dataUrl)};save();try{fs.writeFileSync(path.join(UPLOADS,name),b)}catch(e){}return json(res,200,{image:'/uploads/'+name})}
if(p==='/api/products'&&req.method==='POST'){const me=auth(req);if(!me||me.role!=='Seller')return json(res,403,{error:'Seller account required.'});const x=await body(req);if(!x.name||!x.category||!(Number(x.price)>0)||!(Number(x.stock)>=0)||!x.unit)return json(res,400,{error:'Product, category, price, unit and stock required.'});const pr={id:db.next.product++,name:String(x.name),category:String(x.category),price:Number(x.price),unit:String(x.unit),stock:Number(x.stock),sellerId:me.id,sellerName:me.name,image:String(x.image||''),description:String(x.description||''),createdAt:new Date().toISOString()};db.products.push(pr);save();return json(res,200,{product:pr})}
if(p==='/api/seller/dashboard'&&req.method==='GET'){const me=auth(req);if(!me||me.role!=='Seller')return json(res,403,{error:'Seller account required.'});const ps=db.products.filter(x=>x.sellerId===me.id),os=db.orders.filter(o=>o.items.some(i=>i.sellerId===me.id));return json(res,200,{products:ps.length,orders:os.length,sales:os.reduce((s,o)=>s+o.items.filter(i=>i.sellerId===me.id).reduce((a,i)=>a+i.price*i.qty,0),0)})}
if(p==='/api/orders'&&req.method==='POST'){const x=await body(req),me=auth(req);if(x.paymentMethod!=='COD')return json(res,400,{error:'Only Cash on Delivery is available.'});if(!Array.isArray(x.items)||!x.items.length||!x.customer?.name||!/^[0-9]{10}$/.test(String(x.customer.mobile))||!x.customer.address)return json(res,400,{error:'Items, name, valid mobile and complete delivery address required.'});const items=[];for(const it of x.items){const pr=db.products.find(z=>z.id===Number(it.productId)),qty=Math.max(1,Number(it.qty)||1);if(!pr||pr.stock<qty)return json(res,400,{error:'Product unavailable: '+(pr?.name||it.productId)});items.push({productId:pr.id,name:pr.name,qty,price:pr.price,unit:pr.unit,sellerId:pr.sellerId,sellerName:pr.sellerName})}items.forEach(i=>db.products.find(z=>z.id===i.productId).stock-=i.qty);if(me&&me.role==='Customer'){me.address=String(x.customer.address);me.place=String(x.customer.place||me.place||'');}
const sellerIds=[...new Set(items.map(i=>i.sellerId))];const notifications=sellerIds.map(sid=>{const su=db.users.find(z=>z.id===sid&&z.role==='Seller');const msg=`Nirvix Ai: New COD order ${'CSZ-'+db.next.order} from ${x.customer.name} (${x.customer.mobile}). ${items.filter(i=>i.sellerId===sid).map(i=>i.name+' x '+i.qty).join(', ')}. Address: ${x.customer.address}`;return {role:'Seller',userId:sid,mobile:su?.mobile||'',message:msg};});const o={id:'CSZ-'+db.next.order++,items,customer:{...x.customer},paymentMethod:'COD',status:'Placed',statusHistory:[{status:'Placed',at:new Date().toISOString()}],total:items.reduce((s,i)=>s+i.price*i.qty,0),notifications,createdAt:new Date().toISOString()};db.orders.push(o);save();return json(res,200,{order:o,notifications})}
if(p==='/api/orders/my'&&req.method==='GET'){const me=auth(req);if(!me)return json(res,401,{error:'Login required'});return json(res,200,{orders:db.orders.filter(o=>o.customer.mobile===me.mobile)})}
if(p==='/api/orders/seller'&&req.method==='GET'){const me=auth(req);if(!me||me.role!=='Seller')return json(res,403,{error:'Seller login required'});return json(res,200,{orders:db.orders.filter(o=>o.items.some(i=>i.sellerId===me.id))})}
if(p.startsWith('/api/orders/')&&req.method==='PATCH'){const me=auth(req),id=p.split('/').pop();if(!me||me.role!=='Seller')return json(res,403,{error:'Seller login required'});const x=await body(req),o=db.orders.find(z=>z.id===id);if(!o||!o.items.some(i=>i.sellerId===me.id))return json(res,404,{error:'Order not found'});if(!['Confirmed','Out for Delivery','Delivered','Cancelled'].includes(x.status))return json(res,400,{error:'Invalid status'});o.status=x.status;o.statusHistory=Array.isArray(o.statusHistory)?o.statusHistory:[];o.statusHistory.push({status:x.status,at:new Date().toISOString()});save();return json(res,200,{order:o})}
if(p==='/api/listings'&&req.method==='GET'){const type=u.query.type;return json(res,200,{listings:db.listings.filter(x=>!type||x.type===type).filter(x=>x.status!=='Deleted')})}
if(p==='/api/listings'&&req.method==='POST'){const me=auth(req);if(!me||me.role!=='Provider')return json(res,403,{error:'Provider login required'});const x=await body(req);if(!['Room','Transport'].includes(x.type)||!x.name||!x.address||!x.rate)return json(res,400,{error:'Type, name, address and rate are required.'});const l={id:db.next.listing++,providerId:me.id,providerName:me.name,type:x.type,name:String(x.name),rent:String(x.rent||''),rate:String(x.rate),address:String(x.address),description:String(x.description||''),rating:Number(x.rating||5),image:String(x.image||''),status:'Active',createdAt:new Date().toISOString()};db.listings.push(l);save();return json(res,200,{listing:l})}
if(p.startsWith('/api/listings/')&&req.method==='PATCH'){const me=auth(req),id=Number(p.split('/').pop());const l=db.listings.find(x=>x.id===id);if(!me||!l||l.providerId!==me.id)return json(res,403,{error:'Not your listing'});Object.assign(l,{name:String((await body(req)).name||l.name)});save();return json(res,200,{listing:l})}
if(p==='/api/provider/upload-image'&&req.method==='POST'){const me=auth(req);if(!me||me.role!=='Provider')return json(res,403,{error:'Provider login required'});const x=await body(req),m=String(x.dataUrl||'').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);if(!m)return json(res,400,{error:'Only JPG, PNG or WEBP image is allowed.'});const b=Buffer.from(m[2],'base64');if(b.length>4*1024*1024)return json(res,400,{error:'Image must be 4 MB or smaller.'});const ext=m[1].split('/')[1].replace('jpeg','jpg'),name=crypto.randomBytes(12).toString('hex')+'.'+ext;db.images=db.images||{};db.images[name]={type:m[1],data:String(x.dataUrl)};save();try{fs.writeFileSync(path.join(UPLOADS,name),b)}catch(e){}return json(res,200,{image:'/uploads/'+name})}
if(p==='/api/bookings'&&req.method==='POST'){const me=auth(req);if(!me||me.role!=='Customer')return json(res,403,{error:'Customer login required'});const x=await body(req),l=db.listings.find(z=>z.id===Number(x.listingId));if(!l||l.status!=='Active')return json(res,404,{error:'Listing unavailable'});if(x.address){me.address=String(x.address).trim();save()}
const pu=db.users.find(z=>z.id===l.providerId&&z.role==='Provider');const notificationMessage=`Nirvix Ai: New ${l.type} booking ${'B-'+db.next.booking} for ${l.name} from ${me.name} (${me.mobile}). Address: ${String(x.address||me.address||'')}`;const b={id:'B-'+db.next.booking++,listingId:l.id,providerId:l.providerId,providerName:l.providerName,providerMobile:pu?.mobile||'',customerId:me.id,customerName:me.name,customerMobile:me.mobile,address:String(x.address||me.address||''),type:l.type,name:l.name,status:'Booked',notification:{mobile:pu?.mobile||'',message:notificationMessage},createdAt:new Date().toISOString()};db.bookings.push(b);save();return json(res,200,{booking:b,notification:b.notification})}
if(p==='/api/bookings/my'&&req.method==='GET'){const me=auth(req);if(!me)return json(res,401,{error:'Login required'});return json(res,200,{bookings:me.role==='Provider'?db.bookings.filter(x=>x.providerId===me.id):db.bookings.filter(x=>x.customerId===me.id)})}
if(p.startsWith('/api/bookings/')&&req.method==='PATCH'){const me=auth(req),id=p.split('/').pop(),x=await body(req),b=db.bookings.find(z=>z.id===id);if(!me||!b||b.providerId!==me.id)return json(res,403,{error:'Provider only'});if(!['Booked','Accepted','Completed','Cancelled'].includes(x.status))return json(res,400,{error:'Invalid status'});b.status=x.status;save();return json(res,200,{booking:b})}
if(p==='/api/admin/data'&&req.method==='GET'){if(!admin(req))return json(res,403,{error:'Admin only'});return json(res,200,{users:db.users.map(safe),products:db.products,listings:db.listings,orders:db.orders,bookings:db.bookings})}
// Owner-only persistent database management. These mutate the same JSONB snapshot stored in DATABASE_URL.
if(p.startsWith('/api/admin/')&&req.method!=='GET'&&!admin(req))return json(res,403,{error:'Admin only'});
if(p.startsWith('/api/admin/users/')&&req.method==='PATCH'){
 const id=Number(decodeURIComponent(p.split('/').pop())),u=db.users.find(z=>z.id===id);if(!u)return json(res,404,{error:'User not found'});
 const x=await body(req);if(u.role==='Admin')return json(res,403,{error:'Admin account profile cannot be edited here.'});
 if(x.name!==undefined)u.name=String(x.name).trim().slice(0,120)||u.name;
 if(x.mobile!==undefined){const mobile=String(x.mobile).replace(/\D/g,'');if(mobile&&!/^\d{10}$/.test(mobile))return json(res,400,{error:'Mobile must contain 10 digits.'});if(mobile&&db.users.some(z=>z.id!==u.id&&z.role===u.role&&z.mobile===mobile))return json(res,409,{error:'Mobile already exists for this role.'});u.mobile=mobile;}
 if(x.email!==undefined)u.email=String(x.email||'').trim().toLowerCase().slice(0,180);
 if(x.place!==undefined)u.place=String(x.place||'').trim().slice(0,200);
 if(x.address!==undefined)u.address=String(x.address||'').trim().slice(0,500);
 if(x.pincode!==undefined)u.pincode=String(x.pincode||'').replace(/\D/g,'').slice(0,6);
 if(x.role!==undefined){if(!['Customer','Seller','Provider'].includes(x.role))return json(res,400,{error:'Role must be Customer, Seller or Provider.'});u.role=x.role;}
 save();await persistQueue;return json(res,200,{user:safe(u)});
}
if(p.startsWith('/api/admin/users/')&&req.method==='DELETE'){
 const id=Number(decodeURIComponent(p.split('/').pop())),u=db.users.find(z=>z.id===id);if(!u)return json(res,404,{error:'User not found'});if(u.role==='Admin')return json(res,403,{error:'Admin account cannot be deleted here.'});
 const mobile=u.mobile;db.users=db.users.filter(z=>z.id!==id);db.sessions=db.sessions.filter(z=>z.userId!==id);
 db.listings=db.listings.filter(z=>z.providerId!==id);db.products=db.products.filter(z=>z.sellerId!==id);
 db.bookings=db.bookings.filter(z=>z.customerId!==id&&z.providerId!==id);
 db.orders=db.orders.filter(o=>o.customer?.mobile!==mobile&&!o.items?.some(i=>i.sellerId===id));
 save();await persistQueue;return json(res,200,{ok:true,deletedUserId:id});
}
if(p.startsWith('/api/admin/bookings/')&&req.method==='PATCH'){
 const id=decodeURIComponent(p.split('/').pop()),b=db.bookings.find(z=>String(z.id)===id);if(!b)return json(res,404,{error:'Booking not found'});const x=await body(req);
 for(const k of ['status','address','name'])if(x[k]!==undefined)b[k]=String(x[k]).trim().slice(0,500);
 save();await persistQueue;return json(res,200,{booking:b});
}
if(p.startsWith('/api/admin/bookings/')&&req.method==='DELETE'){
 const id=decodeURIComponent(p.split('/').pop()),n=db.bookings.length;db.bookings=db.bookings.filter(z=>String(z.id)!==id);if(db.bookings.length===n)return json(res,404,{error:'Booking not found'});save();await persistQueue;return json(res,200,{ok:true,deletedBookingId:id});
}
if(p.startsWith('/api/admin/orders/')&&req.method==='PATCH'){
 const id=decodeURIComponent(p.split('/').pop()),o=db.orders.find(z=>String(z.id)===id);if(!o)return json(res,404,{error:'Order not found'});const x=await body(req);if(x.status!==undefined){if(!['Placed','Confirmed','Out for Delivery','Delivered','Cancelled'].includes(x.status))return json(res,400,{error:'Invalid order status'});o.status=x.status;o.statusHistory=Array.isArray(o.statusHistory)?o.statusHistory:[];o.statusHistory.push({status:x.status,at:new Date().toISOString()});}if(x.customer&&typeof x.customer==='object')o.customer={...o.customer,...x.customer};save();await persistQueue;return json(res,200,{order:o});
}
if(p.startsWith('/api/admin/orders/')&&req.method==='DELETE'){
 const id=decodeURIComponent(p.split('/').pop()),n=db.orders.length;db.orders=db.orders.filter(z=>String(z.id)!==id);if(db.orders.length===n)return json(res,404,{error:'Order not found'});save();await persistQueue;return json(res,200,{ok:true,deletedOrderId:id});
}
if(p.startsWith('/api/admin/listings/')&&req.method==='PATCH'){
 const id=Number(decodeURIComponent(p.split('/').pop())),l=db.listings.find(z=>z.id===id);if(!l)return json(res,404,{error:'Listing not found'});const x=await body(req);for(const k of ['name','rent','rate','address','description','status'])if(x[k]!==undefined)l[k]=String(x[k]).trim().slice(0,1000);save();await persistQueue;return json(res,200,{listing:l});
}
if(p.startsWith('/api/admin/listings/')&&req.method==='DELETE'){
 const id=Number(decodeURIComponent(p.split('/').pop())),n=db.listings.length;db.listings=db.listings.filter(z=>z.id!==id);if(db.listings.length===n)return json(res,404,{error:'Listing not found'});db.bookings=db.bookings.filter(z=>z.listingId!==id);save();await persistQueue;return json(res,200,{ok:true,deletedListingId:id});
}
if(p.startsWith('/api/admin/products/')&&req.method==='PATCH'){
 const id=Number(decodeURIComponent(p.split('/').pop())),pr=db.products.find(z=>z.id===id);if(!pr)return json(res,404,{error:'Product not found'});const x=await body(req);for(const k of ['name','category','unit','description'])if(x[k]!==undefined)pr[k]=String(x[k]).trim().slice(0,1000);for(const k of ['price','stock'])if(x[k]!==undefined){const n=Number(x[k]);if(!Number.isFinite(n)||n<0)return json(res,400,{error:'Price and stock must be non-negative numbers.'});pr[k]=n;}save();await persistQueue;return json(res,200,{product:pr});
}
if(p.startsWith('/api/admin/products/')&&req.method==='DELETE'){
 const id=Number(decodeURIComponent(p.split('/').pop())),n=db.products.length;db.products=db.products.filter(z=>z.id!==id);if(db.products.length===n)return json(res,404,{error:'Product not found'});save();await persistQueue;return json(res,200,{ok:true,deletedProductId:id});
}
if(p==='/api/ai/ask'&&req.method==='POST'){const x=await body(req);if(!x.question)return json(res,400,{error:'Question required'});try{return json(res,200,{answer:await ai(x.question)})}catch(e){if(e.message==='AI_KEY_NOT_CONFIGURED')return json(res,503,{error:'AI_KEY_NOT_CONFIGURED'});return json(res,502,{error:e.message||'AI service error'})}}
if(p.startsWith('/uploads/')){const f=path.basename(p),saved=db.images&&db.images[f];if(saved&&saved.data){const m=String(saved.data).match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);if(m){res.writeHead(200,{'Content-Type':m[1],'Cache-Control':'public, max-age=31536000, immutable'});return res.end(Buffer.from(m[2],'base64'))}}const full=path.join(UPLOADS,f);if(!full.startsWith(UPLOADS)||!fs.existsSync(full))return text(res,404,'Not found','text/plain');return fs.readFile(full,(e,b)=>e?text(res,404,'Not found','text/plain'):text(res,200,b,mime(f)))}
// Uploaded Nirvix Ai intro video.
if(p==='/1000073799.mp4'){const f=path.join(ROOT,'1000073799.mp4');if(!fs.existsSync(f))return text(res,404,'Video not found','text/plain');const b=fs.readFileSync(f);res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':b.length,'Cache-Control':'public, max-age=86400','Accept-Ranges':'bytes'});return res.end(b)}
// PWA static assets (served before the single-page home-page fallback).
if(p==='/manifest.json'){const f=path.join(ROOT,'manifest.json');if(fs.existsSync(f))return text(res,200,fs.readFileSync(f),'application/manifest+json; charset=utf-8');return text(res,404,'Not found','text/plain')}
if(p==='/service-worker.js'){const f=path.join(ROOT,'service-worker.js');if(fs.existsSync(f)){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-cache','Service-Worker-Allowed':'/'});return res.end(fs.readFileSync(f))}return text(res,404,'Not found','text/plain')}
if(p.startsWith('/icons/')){const name=path.basename(p);if(!/^(?:icon-(192|512)|logo)\.png$/.test(name))return text(res,404,'Not found','text/plain');const f=path.join(ROOT,'icons',name);if(!fs.existsSync(f))return text(res,404,'Not found','text/plain');res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public, max-age=86400'});return res.end(fs.readFileSync(f))}
if(p.startsWith('/api/'))return json(res,404,{error:'API route not found'});
// Serve the website home page even if the files were uploaded into a common subfolder.
function findHomeFile(){
 const direct=[path.join(ROOT,'public','index.html'),path.join(ROOT,'index.html'),path.join(ROOT,'dist','index.html'),path.join(ROOT,'build','index.html'),path.join(ROOT,'client','index.html'),path.join(ROOT,'client','public','index.html')];
 for(const f of direct){try{if(fs.existsSync(f)&&fs.statSync(f).isFile())return f}catch{}}
 const skip=new Set(['.git','node_modules','android-wrapper','data','uploads']);
 function walk(dir,depth){if(depth<0)return null;let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true})}catch{return null}
  for(const e of entries){if(e.isFile()&&e.name.toLowerCase()==='index.html')return path.join(dir,e.name)}
  for(const e of entries){if(e.isDirectory()&&!skip.has(e.name)&&!e.name.startsWith('.')){const found=walk(path.join(dir,e.name),depth-1);if(found)return found}}
  return null;
 }
 return walk(ROOT,3);
}
const homeFile=findHomeFile();
if(homeFile)return text(res,200,fs.readFileSync(homeFile),'text/html; charset=utf-8');
console.error('Website home page not found. Expected public/index.html or index.html under:',ROOT);
return text(res,500,'Nirvix Ai website file missing. Ensure public/index.html (or index.html) is uploaded to the same Render Root Directory as server.js.','text/plain; charset=utf-8');
}catch(e){console.error(e);if(!res.headersSent)json(res,500,{error:e.message||'Server error'})}});
async function start(){if(pgPool){try{await pgPool.query('CREATE TABLE IF NOT EXISTS csz_app_state (id INTEGER PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');const result=await pgPool.query('SELECT payload FROM csz_app_state WHERE id=1');if(result.rows[0]?.payload){db={...db,...result.rows[0].payload,next:{...db.next,...(result.rows[0].payload.next||{})}};try{fs.writeFileSync(DB,JSON.stringify(db,null,2))}catch{}}else{await pgPool.query('INSERT INTO csz_app_state(id,payload,updated_at) VALUES(1,$1::jsonb,NOW()) ON CONFLICT(id) DO NOTHING',[JSON.stringify(db)])}pgReady=true;console.log('Persistent PostgreSQL database connected.')}catch(e){console.error('DATABASE_URL is configured but PostgreSQL initialization failed:',e.message);process.exitCode=1;return}}else{console.warn('DATABASE_URL is not set. Data is stored only in local JSON and may be lost on Render free services.')}server.listen(PORT,()=>console.log(`Nirvix Ai V6 running on ${PORT}`))}
start();
