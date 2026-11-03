import test from 'node:test';
import assert from 'node:assert/strict';
import {trackShipment,normalizeShip24,publicConfig,getCouriers,validateRequest} from '../lib/tracking-service.mjs';
const example={tracker:{trackingNumber:'TEST12345',courierCode:['us-post']},shipment:{statusMilestone:'delivered',destinationCountryCode:'US',trackingNumbers:[{tn:'TEST12345'},{tn:'LASTMILE123'}],delivery:{service:'Parcel'},recipient:{postCode:'94901'}},events:[{occurrenceDatetime:'2026-01-02T13:00:00-05:00',status:'Delivered',location:'US',courierCode:'us-post'},{occurrenceDatetime:'2026-01-01T12:00:00+08:00',status:'In transit',courierCode:'cn-post'}]};
test('无密钥不会请求第三方，也不会伪造成功状态',async()=>{
 const r=await trackShipment({number:'1Z1B0D750317229126'},{},()=>{throw Error('must not fetch');});
 assert.equal(r.state,'unconfigured');assert.equal(publicConfig({SHIP24_API_KEY:'secret'}).enabled,true);assert.equal(JSON.stringify(publicConfig({SHIP24_API_KEY:'secret'})).includes('secret'),false);
});
test('真实 API 合约：固定地址、服务端鉴权、可重复参数',async()=>{
 let payload;
 const r=await trackShipment({number:'TEST12345',provider:'ship24',courierCode:'us-post',destinationCountryCode:'US'},{SHIP24_API_KEY:'test-only'},async(url,options)=>{
  assert.equal(url,'https://api.ship24.com/public/v1/trackers/track');assert.equal(options.headers.Authorization,'Bearer test-only');payload=JSON.parse(options.body);
  return Response.json({data:{trackings:[example]}});
 });
 assert.deepEqual(payload,{trackingNumber:'TEST12345',courierCode:['us-post'],destinationCountryCode:'US'});assert.equal(r.shipment.status,'delivered');assert.equal(r.shipment.traces[0].time,'2026-01-02 13:00:00-05:00');assert.equal(r.shipment.outer_carrier_tracking_number,'LASTMILE123');
});
test('同号多票不错误合并，等待不当成已签收',()=>{
 assert.equal(normalizeShip24({data:{trackings:[example,example]}},'TEST12345').state,'ambiguous');
 assert.equal(normalizeShip24({data:{trackings:[]}},'TEST12345').state,'waiting');
 assert.throws(()=>normalizeShip24({data:{trackings:[example]}},'WRONG12345'));
});
test('鉴权、配额和限流失败明确呈现，密钥不进入错误消息',async()=>{
 for(const status of [401,403,422,429,500]) await assert.rejects(trackShipment({number:'TEST12345'},{SHIP24_API_KEY:'secret'},async()=>new Response('secret',{status})),e=>!e.message.includes('secret')&&Boolean(e.code));
});
test('承运商目录排除下线渠道，保留必要查询字段',async()=>{
 const r=await getCouriers({SHIP24_API_KEY:'test-only'},async()=>Response.json({data:{couriers:[{courierCode:'us-post',courierName:'USPS',requiredFields:['destinationPostCode']},{courierCode:'old',courierName:'Old',isDeprecated:true}]}}));
 assert.equal(r.couriers.length,1);assert.deepEqual(r.couriers[0].requiredFields,['destinationPostCode']);
});
test('验证额外字段与显式众乐选择',async()=>{
 assert.throws(()=>validateRequest({number:'TEST12345',shippingDate:'2026-02-30'}));
 assert.throws(()=>validateRequest({number:'TEST12345',provider:'https://evil.test'}));
 const r=await trackShipment({number:'BG2608182036'}, {},async url=>{assert.equal(url.hostname,'gzzlgj.nextsls.com');return Response.json({status:1,data:{shipment:{status:'delivered',traces:[]}}});});assert.equal(r.source,'zhongle');
});
