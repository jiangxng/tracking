import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNumbers, validateNumbers, normalizeResponse, category, toCSV, carrierLink } from '../public/tracking.js';
test('UPS 单号提供官网入口，源站无记录不误判单号无效', () => {
  assert.equal(carrierLink('1Z1B0D750317229126').url, 'https://www.ups.com/track?loc=zh_CN&tracknum=1Z1B0D750317229126');
  assert.equal(carrierLink('1z1b0d750317229126').name, 'UPS');
  assert.equal(carrierLink('BG2608182036'), null);
  assert.equal(carrierLink('1Z<script>'), null);
  const r = normalizeResponse({status:0,info:'抱歉！操作失败，请重新操作。'}, '1Z1B0D750317229126');
  assert.equal(r.state, 'missing'); assert.match(r.message, /众乐数据源/); assert.equal(r.sourceMessage, '抱歉！操作失败，请重新操作。');
});
test('批量输入去重、中文分隔符及数量限制', () => {
  assert.deepEqual(parseNumbers('BG1\nBG2，BG1; BG3；BG4'), ['BG1','BG2','BG3','BG4']);
  assert.ok(validateNumbers([])); assert.ok(validateNumbers(Array.from({length:21},(_,i)=>String(i))));
  assert.equal(validateNumbers(['BG2608182036']), '');
});
test('源站响应验证：区分无结果、错误和成功，按时间倒序', () => {
  assert.equal(normalizeResponse({status:0}, 'X').state, 'missing');
  assert.throws(() => normalizeResponse({status:1,data:{}}, 'X'));
  assert.throws(() => normalizeResponse({unexpected:true}, 'X'));
  const r = normalizeResponse({status:1,data:{shipment:{status:'delivered',parcel_count:34,traces:[{time:'2026-08-18 10:00:00',info:'收货'},{time:'2026-08-29 10:00:00',info:'签收'}]}}}, 'BG1');
  assert.equal(r.shipment.traces[0].info, '签收'); assert.equal(r.shipment.parcel_count,'34'); assert.equal(category(r), 'delivered');
  assert.equal(category({state:'error'}), 'attention');
});
test('CSV 包含所有轨迹，安全处理公式、引号和换行', () => {
  const r = normalizeResponse({status:1,data:{shipment:{status:'in_transit',traces:[{time:'2026-01-01',info:'=SUM(1,2)'},{time:'2026-01-02',info:'包含"引号"\n换行'}]}}}, 'BG1');
  const csv=toCSV([r,{state:'missing'}]);
  assert.ok(csv.startsWith('\ufeff')); assert.ok(csv.includes("'=SUM(1,2)")); assert.ok(csv.includes('包含""引号""\n换行')); assert.ok(csv.includes('运输中'));
});
