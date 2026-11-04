import test from 'node:test';
import assert from 'node:assert/strict';
import {publicConfig,trackShipment,normalizeUPS,normalizeDHL,normalizeFedEx,normalizeUSPS,normalizeKarrio} from '../lib/free-tracking-service.mjs';

const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
test('未配置时准确呈现状态，未知单号不猜测承运商',async()=>{
 const config=publicConfig({});
 assert.equal(config.providers.find(p=>p.id==='zhongle').enabled,true);
 assert.equal(config.providers.find(p=>p.id==='ups').enabled,false);
 const ups=await trackShipment({number:'1Z1B0D750317229126'},{});
 assert.equal(ups.state,'unconfigured');assert.equal(ups.source,'ups');
 assert.equal((await trackShipment({number:'ABC123456'},{})).state,'ambiguous');
 assert.equal((await trackShipment({number:'1234567890'},{})).source,'dhl');
});
test('UPS 官方 OAuth 与轨迹请求，保持单号和事件',async()=>{
 const calls=[];
 const fetcher=async(url,options)=>{calls.push({url:String(url),options});return calls.length===1?response({access_token:'mock-token'}):response({trackResponse:{shipment:[{package:[{currentStatus:{code:'D'},activity:[{date:'20261104',time:'123000',status:{description:'Delivered'},location:{address:{city:'Shanghai'}}}]}]}]}})};
 const r=await trackShipment({number:'1Z1B0D750317229126',provider:'ups'},{UPS_CLIENT_ID:'test',UPS_CLIENT_SECRET:'secret'},fetcher);
 assert.equal(r.shipment.status,'delivered');assert.match(r.shipment.traces[0].time,/2026-11-04/);
 assert.match(calls[0].url,/security\/v1\/oauth\/token/);
 assert.match(calls[1].url,/track\/v1\/details\/1Z1B0D750317229126/);
 assert.equal(calls[1].options.headers.Authorization,'Bearer mock-token');
});
test('DHL、FedEx 与 Karrio 标准化时保留来源和事件',()=>{
 assert.equal(normalizeDHL({shipments:[{status:{statusCode:'delivered'},events:[{timestamp:'2026-11-04T10:00:00',description:'Delivered'}]}]},'1234567890').shipment.status,'delivered');
 assert.equal(normalizeFedEx({output:{completeTrackResults:[{trackResults:[{latestStatusDetail:{code:'DL'},scanEvents:[{date:'2026-11-04T10:00:00',eventDescription:'Delivered'}]}]}]}},'123456789012').shipment.traces.length,1);
 assert.equal(normalizeKarrio({carrier_name:'usps',status:'in_transit',events:[{date:'2026-11-04',description:'Accepted'}]},'9400000000').source,'karrio');
 assert.equal(normalizeUSPS({trackingNumber:'9400000000',statusCategory:'Delivered',trackingEvents:[{eventType:'Delivered',eventTimestamp:'2026-11-04T10:00:00Z'}]},'9400000000').shipment.status,'delivered');
 assert.equal(normalizeUPS({trackResponse:{shipment:[]}},'1Z1B0D750317229126').state,'missing');
});
test('Karrio 用官方创建追踪接口，不接受不匹配的单号',async()=>{
 const calls=[];
 const fetcher=async(url,options)=>{calls.push({url:String(url),options});return response({tracking_number:'1Z1B0D750317229126',carrier_name:'ups',status:'pending',events:[]})};
 const r=await trackShipment({number:'1Z1B0D750317229126',provider:'karrio'},{KARRIO_BASE_URL:'https://example.org',KARRIO_API_KEY:'mock'},fetcher);
 assert.equal(r.source,'karrio');assert.equal(calls[0].options.method,'POST');
 assert.equal(JSON.parse(calls[0].options.body).carrier_name,'ups');
 assert.equal(calls[0].url,'https://example.org/v1/trackers');
});
test('USPS 仅在配置账号后调用官方追踪接口',async()=>{
 const calls=[];
 const fetcher=async(url,options)=>{calls.push({url:String(url),options});return calls.length===1?response({access_token:'mock-token'}):response({trackingNumber:'9400000000',statusCategory:'Delivered',trackingEvents:[]})};
 const r=await trackShipment({number:'9400000000',provider:'usps'},{USPS_CLIENT_ID:'test',USPS_CLIENT_SECRET:'secret'},fetcher);
 assert.equal(r.shipment.status,'delivered');
 assert.equal(calls[1].url,'https://apis.usps.com/tracking/v3/tracking/9400000000?expand=DETAIL');
 assert.equal(calls[1].options.headers.Authorization,'Bearer mock-token');
});
