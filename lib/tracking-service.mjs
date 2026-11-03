import { normalizeResponse } from '../public/tracking.js';
const SHIP24 = 'https://api.ship24.com/public/v1';
const clean = v => typeof v === 'string' || typeof v === 'number' ? String(v) : '';
export const isShip24Enabled = env => Boolean(env.SHIP24_API_KEY?.trim()) && env.SHIP24_ENABLED !== 'false';
export function publicConfig(env = {}) { return { provider:'Ship24', enabled:isShip24Enabled(env), zhongleEnabled:true, maxBatch:20 }; }
export class TrackingError extends Error {
  constructor(message, code='UPSTREAM_ERROR', status=502) { super(message); this.code=code; this.status=status; }
}
export function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TrackingError('请求格式不正确。','INVALID_INPUT',400);
  const number=clean(body.number).trim(), provider=body.provider || 'auto';
  if (!number || number.length>100 || /[\s<>\x00-\x1f]/u.test(number)) throw new TrackingError('请检查运单号。','INVALID_INPUT',400);
  if (!['auto','ship24','zhongle'].includes(provider)) throw new TrackingError('不支持的数据源。','INVALID_INPUT',400);
  const options={};
  for (const [key,pattern] of Object.entries({courierCode:/^[a-zA-Z0-9_-]{1,100}$/,destinationCountryCode:/^[A-Z]{2,3}$/,destinationPostCode:/^[A-Za-z0-9 _\-./]{1,32}$/,shippingDate:/^\d{4}-\d{2}-\d{2}$/})) {
    const value=clean(body[key]).trim(); if (!value) continue;
    if (!pattern.test(value)) throw new TrackingError('承运商、目的地或发货日期格式不正确。','INVALID_INPUT',400);
    options[key]=value;
  }
  if (options.shippingDate) { const d=new Date(options.shippingDate+'T00:00:00Z'); if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10)!==options.shippingDate) throw new TrackingError('发货日期无效。','INVALID_INPUT',400); }
  return {number,provider,options};
}
async function readJSON(response) { try { return await response.json(); } catch { throw new TrackingError('物流服务未返回有效数据，请稍后重试。','INVALID_RESPONSE'); } }
async function ship24Fetch(path,env,fetcher,payload) {
  let r; try { r=await fetcher(SHIP24+path,{method:payload?'POST':'GET',headers:{Authorization:`Bearer ${env.SHIP24_API_KEY.trim()}`,'Content-Type':'application/json',Accept:'application/json'},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(payload?65000:20000),redirect:'error'}); }
  catch(e) { throw new TrackingError(e.name==='TimeoutError'?'聚合服务首次查询超时，可稍后重试。':'无法连接聚合物流服务，请稍后重试。','UPSTREAM_NETWORK',504); }
  if ([401,403].includes(r.status)) throw new TrackingError('Ship24 密钥无效或权限不足，请检查服务端配置。','AUTH_FAILED');
  if (r.status===429) throw new TrackingError('查询频率过高，请稍后重试。','RATE_LIMIT',429);
  if ([402,422].includes(r.status)) throw new TrackingError('Ship24 拒绝查询，请检查 API 套餐、剩余额度及运单信息。','PLAN_OR_INPUT',422);
  if (!r.ok) throw new TrackingError(`聚合物流服务暂不可用（HTTP ${r.status}）。`);
  const data=await readJSON(r); if (data.errors?.length) throw new TrackingError('聚合服务未能完成查询，请检查承运商与运单信息。'); return data;
}
export async function getCouriers(env,fetcher=fetch) {
  if (!isShip24Enabled(env)) return {enabled:false,couriers:[]};
  const data=await ship24Fetch('/couriers',env,fetcher);
  if (!Array.isArray(data.data?.couriers)) throw new TrackingError('承运商目录响应不完整。','INVALID_RESPONSE');
  return {enabled:true,couriers:data.data.couriers.filter(c=>!c.isDeprecated&&c.courierCode&&c.courierName).map(c=>({code:clean(c.courierCode),name:clean(c.courierName),country:clean(c.countryCode),requiredFields:Array.isArray(c.requiredFields)?c.requiredFields.map(clean):[]}))};
}
export function normalizeShip24(data,number) {
  const entries=data?.data?.trackings;
  if (!Array.isArray(entries)) throw new TrackingError('聚合服务返回的轨迹格式不完整。','INVALID_RESPONSE');
  if (!entries.length) return {number,state:'waiting',source:'ship24',message:'Ship24 暂无轨迹，可能仍在向承运商获取数据，请稍后刷新。'};
  // Never merge unrelated shipments that share a tracking number.
  if (entries.length>1) return {number,state:'ambiguous',source:'ship24',message:'此单号匹配多票货物，请指定承运商、目的地或准确发货日期后重试。'};
  const {shipment:s,events=[],tracker={}}=entries[0];
  if (!s || !Array.isArray(events)) throw new TrackingError('聚合服务返回的运单信息不完整。','INVALID_RESPONSE');
  if (tracker.trackingNumber && tracker.trackingNumber!==number) throw new TrackingError('返回单号与查询单号不匹配。','INVALID_RESPONSE');
  const codes=[...new Set(events.map(e=>clean(e.courierCode)).filter(Boolean))];
  if (!codes.length) codes.push(...(Array.isArray(tracker.courierCode)?tracker.courierCode:tracker.courierCode?[tracker.courierCode]:[]));
  // Preserve Ship24's descending order instead of comparing local times across zones.
  const traces=events.map((e,index)=>({time:clean(e.occurrenceDatetime||e.datetime).replace('T',' '),info:[clean(e.status),clean(e.location)].filter(Boolean).join(' · '),carrier:clean(e.courierCode),trackingNumber:clean(e.eventTrackingNumber),index}));
  return {number,state:'success',source:'ship24',shipment:{shipment_id:number,client_reference:'',ext_number:'',outer_carrier_code:codes.join(' / ')||'承运商识别中',outer_carrier_tracking_number:(s.trackingNumbers||[]).map(t=>clean(t.tn)).filter(n=>n&&n!==number).join(' / '),status:clean(s.statusMilestone)||'pending',country:clean(s.destinationCountryCode),origin:clean(s.originCountryCode),postcode:clean(s.recipient?.postCode),parcel_count:'',traces,service:clean(s.delivery?.service),eta:clean(s.delivery?.courierEstimatedDeliveryDate?.from||s.delivery?.estimatedDeliveryDate)}};
}
async function queryZhongle(number,fetcher) {
  const url=new URL('https://gzzlgj.nextsls.com/tracking/app');url.searchParams.set('inajax','1');url.searchParams.set('tracking_number',number);
  let r; try {r=await fetcher(url,{signal:AbortSignal.timeout(30000),redirect:'error'});} catch {throw new TrackingError('无法连接众乐数据源，请稍后重试。','UPSTREAM_NETWORK',504);}
  if (!r.ok) throw new TrackingError(`众乐查询失败（HTTP ${r.status}）。`);
  return {...normalizeResponse(await readJSON(r),number),source:'zhongle'};
}
export async function trackShipment(input,env={},fetcher=fetch) {
  const {number,provider,options}=validateRequest(input);
  if (provider==='zhongle' || provider==='auto'&&/^BG\d{8,}$/i.test(number)&&!options.courierCode) return queryZhongle(number,fetcher);
  if (!isShip24Enabled(env)) return {number,state:'unconfigured',source:'ship24',message:'多承运商查询尚未启用。请先配置 Ship24 API 账号密钥；当前不能获取 UPS、FedEx、DHL 等承运商的实时轨迹。'};
  if (number.length<5 || number.length>50 || !/^[a-zA-Z0-9_/.\-]+$/.test(number)) throw new TrackingError('Ship24 单号需为 5–50 位字母、数字或 - _ / .，请核对。','INVALID_INPUT',400);
  const payload={trackingNumber:number,...options};if(options.courierCode)payload.courierCode=[options.courierCode];
  return normalizeShip24(await ship24Fetch('/trackers/track',env,fetcher,payload),number);
}
