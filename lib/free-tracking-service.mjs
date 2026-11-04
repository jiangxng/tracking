import { normalizeResponse } from '../public/tracking.js';
const value=v=>v==null?'':String(v);
export class TrackingError extends Error { constructor(message,code='UPSTREAM',status=502){super(message);this.code=code;this.status=status;} }
const providers=[['zhongle','众乐国际'],['ups','UPS'],['dhl','DHL'],['fedex','FedEx'],['usps','USPS'],['karrio','Karrio 自托管']];
export function publicConfig(env={}) {return {providers:providers.map(([id,name])=>({id,name,enabled:id==='zhongle'||id==='ups'&&!!(env.UPS_CLIENT_ID&&env.UPS_CLIENT_SECRET)||id==='dhl'&&!!env.DHL_API_KEY||id==='fedex'&&!!(env.FEDEX_CLIENT_ID&&env.FEDEX_CLIENT_SECRET)||id==='usps'&&!!(env.USPS_CLIENT_ID&&env.USPS_CLIENT_SECRET)||id==='karrio'&&!!(env.KARRIO_BASE_URL&&env.KARRIO_API_KEY)})),maxBatch:20};}
export function validateRequest(body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw new TrackingError('请求格式不正确。','INPUT',400);
 const number=value(body.number).trim(),provider=value(body.provider||'auto'),courierCode=value(body.courierCode).trim();
 if(!/^[a-zA-Z0-9_/.\-]{4,100}$/.test(number))throw new TrackingError('运单号格式不正确。','INPUT',400);
 if(!['auto','zhongle','ups','dhl','fedex','usps','karrio'].includes(provider))throw new TrackingError('不支持的数据源。','INPUT',400);
 if(courierCode&&!/^[a-zA-Z0-9_-]{1,60}$/.test(courierCode))throw new TrackingError('承运商代码格式不正确。','INPUT',400);
 return {number,provider,courierCode};
}
async function read(response,name){
 if(response.status===429)throw new TrackingError(`${name} 查询频率已达限制，请稍后重试。`,'RATE_LIMIT',429);
 if([401,403].includes(response.status))throw new TrackingError(`${name} 授权失败，请检查账号凭据。`,'AUTH');
 if(!response.ok)throw new TrackingError(`${name} 查询失败（HTTP ${response.status}）。`);
 try{return await response.json();}catch{throw new TrackingError(`${name} 返回的数据格式无效。`,'INVALID_RESPONSE');}
}
const normalized=(number,source,fields={})=>({number,source,state:'success',shipment:{shipment_id:number,client_reference:'',ext_number:'',outer_carrier_code:source,outer_carrier_tracking_number:'',country:'',postcode:'',parcel_count:'',status:'in_transit',traces:[],...fields,traces:[...(fields.traces||[])].sort((a,b)=>b.time.localeCompare(a.time)||a.index-b.index)}});
export function normalizeDHL(data,number){
 const a=data?.shipments;if(!Array.isArray(a))throw new TrackingError('DHL 响应缺少运单列表。','INVALID_RESPONSE');
 if(!a.length)return{number,source:'dhl',state:'missing',message:'DHL 未返回该单号的运单。'};
 if(a.length>1)return{number,source:'dhl',state:'ambiguous',message:'DHL 返回多票匹配运单，请到官网核对。'};
 const s=a[0],ev=Array.isArray(s.events)?s.events:[],status=value(s.status?.statusCode||s.status?.status).toLowerCase();
 return normalized(number,'dhl',{outer_carrier_code:value(s.service||'DHL'),status:status.includes('delivered')?'delivered':status.includes('exception')?'exception':status||'in_transit',country:value(s.destination?.address?.countryCode),postcode:value(s.destination?.address?.postalCode),eta:value(s.estimatedTimeOfDelivery),traces:ev.map((e,i)=>({time:value(e.timestamp).replace('T',' '),info:[e.description,e.location?.address?.addressLocality,e.location?.address?.countryCode].filter(Boolean).join(' · '),index:i}))});
}
export function normalizeFedEx(data,number){
 const a=data?.output?.completeTrackResults?.[0]?.trackResults;if(!Array.isArray(a))throw new TrackingError('FedEx 响应缺少轨迹。','INVALID_RESPONSE');
 if(!a.length)return{number,source:'fedex',state:'missing',message:'FedEx 未返回该单号的运单。'};
 if(a.length>1)return{number,source:'fedex',state:'ambiguous',message:'FedEx 返回多票匹配运单，请到官网核对。'};
 const s=a[0],ev=Array.isArray(s.scanEvents)?s.scanEvents:[];
 return normalized(number,'fedex',{status:s.latestStatusDetail?.code==='DL'?'delivered':s.latestStatusDetail?.code==='DE'?'exception':'in_transit',country:value(s.recipientInformation?.address?.countryCode),postcode:value(s.recipientInformation?.address?.postalCode),service:value(s.serviceDetail?.description),traces:ev.map((e,i)=>({time:value(e.date).replace('T',' '),info:[e.eventDescription,e.scanLocation?.city,e.scanLocation?.stateOrProvinceCode,e.scanLocation?.countryCode].filter(Boolean).join(' · '),index:i}))});
}
export function normalizeUPS(data,number){
 const a=data?.trackResponse?.shipment;
 if(!Array.isArray(a))throw new TrackingError('UPS 响应缺少运单列表。','INVALID_RESPONSE');
 if(!a.length)return{number,source:'ups',state:'missing',message:'UPS 未返回该单号的运单。'};
 if(a.length>1)return{number,source:'ups',state:'ambiguous',message:'UPS 返回多票匹配运单，请到官网核对。'};
 const shipment=a[0],packages=shipment.package||[];
 if(packages.length!==1)return{number,source:'ups',state:'ambiguous',message:'UPS 返回多件包裹，请到官网核对。'};
 const p=packages[0],ev=Array.isArray(p.activity)?p.activity:[];
 const status=value(p.currentStatus?.code||p.currentStatus?.description).toLowerCase();
 return normalized(number,'ups',{outer_carrier_code:'UPS',status:status==='d'||status.includes('delivered')?'delivered':status==='x'?'exception':'in_transit',country:value(shipment.shipTo?.address?.countryCode),postcode:value(shipment.shipTo?.address?.postalCode),eta:value(p.deliveryDate?.[0]?.date),traces:ev.map((e,i)=>({time:[value(e.date).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),value(e.time).replace(/^(\d{2})(\d{2})(\d{2})$/,'$1:$2:$3')].filter(Boolean).join(' '),info:[e.status?.description,e.location?.address?.city,e.location?.address?.countryCode].filter(Boolean).join(' · '),index:i}))});
}
export function normalizeUSPS(data,number){
 if(!data||!Array.isArray(data.trackingEvents)||data.trackingNumber!==number)throw new TrackingError('USPS 响应缺少匹配的运单轨迹。','INVALID_RESPONSE');
 const status=value(data.statusCategory).toLowerCase();
 return normalized(number,'usps',{outer_carrier_code:'USPS',status:status.includes('delivered')?'delivered':status.includes('alert')?'exception':'in_transit',postcode:value(data.destinationZIP),service:value(data.mailClass).replace(/<[^>]*>/g,''),traces:data.trackingEvents.map((e,i)=>({time:value(e.eventTimestamp).replace('T',' '),info:[e.eventType,e.eventCity,e.eventState,e.eventCountry].filter(Boolean).join(' · '),index:i}))});
}
export function normalizeKarrio(data,number){
 if(!data||!Array.isArray(data.events))throw new TrackingError('Karrio 响应缺少轨迹。','INVALID_RESPONSE');
 return normalized(number,'karrio',{outer_carrier_code:value(data.carrier_name||'Karrio'),status:value(data.status||'pending'),eta:value(data.estimated_delivery),traces:data.events.map((e,i)=>({time:[e.date,e.time].filter(Boolean).join(' '),info:[e.description,e.location].filter(Boolean).join(' · '),index:i}))});
}
export async function trackShipment(input,env={},fetcher=fetch){
 const {number,provider,courierCode}=validateRequest(input);
 const selected=provider==='auto'?/^BG\d{8,}$/i.test(number)?'zhongle':/^1Z[0-9A-Z]{16}$/i.test(number)?'ups':/^\d{10}$/.test(number)?'dhl':null:provider;
 if(!selected)return{number,state:'ambiguous',source:'auto',message:'无法仅凭单号可靠识别承运商，请手动选择数据源。'};
 const item=publicConfig(env).providers.find(p=>p.id===selected);
 if(!item.enabled)return{number,state:'unconfigured',source:selected,message:`${item.name} 免费接口尚未配置。请在“接入设置”查看所需账号；可用承运商官网核验。`};
 try{
  if(selected==='zhongle'){const u=new URL('https://gzzlgj.nextsls.com/tracking/app');u.searchParams.set('inajax','1');u.searchParams.set('tracking_number',number);return{...normalizeResponse(await read(await fetcher(u,{signal:AbortSignal.timeout(30000),redirect:'error'}),'众乐'),number),source:'zhongle'};}
  if(selected==='ups'){
   const token=await read(await fetcher('https://onlinetools.ups.com/security/v1/oauth/token',{method:'POST',headers:{Authorization:`Basic ${btoa(`${env.UPS_CLIENT_ID}:${env.UPS_CLIENT_SECRET}`)}`,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(30000),redirect:'error'}),'UPS');
   if(!token.access_token)throw new TrackingError('UPS 未返回访问令牌。','AUTH');
   const u=new URL(`https://onlinetools.ups.com/api/track/v1/details/${encodeURIComponent(number)}`);u.searchParams.set('locale','zh_CN');
   return normalizeUPS(await read(await fetcher(u,{headers:{Authorization:`Bearer ${token.access_token}`,transId:crypto.randomUUID(),transactionSrc:'logistics-tracker'},signal:AbortSignal.timeout(30000),redirect:'error'}),'UPS'),number);
  }
  if(selected==='dhl'){const u=new URL('https://api-eu.dhl.com/track/shipments');u.searchParams.set('trackingNumber',number);u.searchParams.set('language','en');return normalizeDHL(await read(await fetcher(u,{headers:{'DHL-API-Key':env.DHL_API_KEY,Accept:'application/json'},signal:AbortSignal.timeout(30000),redirect:'error'}),'DHL'),number);}
  if(selected==='fedex'){
   const auth=await read(await fetcher('https://apis.fedex.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:env.FEDEX_CLIENT_ID,client_secret:env.FEDEX_CLIENT_SECRET}),signal:AbortSignal.timeout(30000),redirect:'error'}),'FedEx');
   if(!auth.access_token)throw new TrackingError('FedEx 未返回访问令牌。','AUTH');
   return normalizeFedEx(await read(await fetcher('https://apis.fedex.com/track/v1/trackingnumbers',{method:'POST',headers:{Authorization:`Bearer ${auth.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({trackingInfo:[{trackingNumberInfo:{trackingNumber:number}}],includeDetailedScans:true}),signal:AbortSignal.timeout(30000),redirect:'error'}),'FedEx'),number);
  }
  if(selected==='usps'){
   const auth=await read(await fetcher('https://apis.usps.com/oauth2/v3/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credentials',client_id:env.USPS_CLIENT_ID,client_secret:env.USPS_CLIENT_SECRET}),signal:AbortSignal.timeout(30000),redirect:'error'}),'USPS');
   if(!auth.access_token)throw new TrackingError('USPS 未返回访问令牌。','AUTH');
   const u=new URL(`https://apis.usps.com/tracking/v3/tracking/${encodeURIComponent(number)}`);u.searchParams.set('expand','DETAIL');
   return normalizeUSPS(await read(await fetcher(u,{headers:{Authorization:`Bearer ${auth.access_token}`},signal:AbortSignal.timeout(30000),redirect:'error'}),'USPS'),number);
  }
  const base=new URL(env.KARRIO_BASE_URL);if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname))throw new TrackingError('Karrio 地址需要 HTTPS。','CONFIG');
  const carrier=courierCode||(/^1Z[0-9A-Z]{16}$/i.test(number)?'ups':'');if(!carrier)return{number,state:'ambiguous',source:'karrio',message:'请在补充查询条件中输入 Karrio 承运商代码。'};
  const u=new URL('/v1/trackers',base);
  const data=await read(await fetcher(u,{method:'POST',headers:{Authorization:`Token ${env.KARRIO_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({tracking_number:number,carrier_name:carrier}),signal:AbortSignal.timeout(30000),redirect:'error'}),'Karrio');
  if(data.tracking_number!==number)throw new TrackingError('Karrio 返回的单号与查询不一致。','INVALID_RESPONSE');
  return normalizeKarrio(data,number);
 }catch(e){if(e instanceof TrackingError)throw e;throw new TrackingError('物流商接口暂时无法连接。','NETWORK',504);}
}
export function getCouriers(env={}){return{enabled:true,couriers:publicConfig(env).providers.map(p=>({code:p.id,name:p.name,country:'',configured:p.enabled,requiredFields:[]}))};}
