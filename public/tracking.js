export const ENDPOINT = 'https://gzzlgj.nextsls.com/tracking/app';
export const STATUS = { ready:'已下单', info_received:'标签已创建', picked:'已收货', in_transit:'运输中', out_for_delivery:'派送中', available_for_pickup:'待取件', failed_attempt:'投递失败', exception:'运输异常', pending:'待更新', delivered:'已签收', returned:'已退件', cancelled:'已取消' };
export function carrierLink(number) {
  const n = String(number).trim().toUpperCase();
  return /^1Z[0-9A-Z]{16}$/.test(n) ? { name: 'UPS', url: `https://www.ups.com/track?loc=zh_CN&tracknum=${encodeURIComponent(n)}` } : null;
}
export function parseNumbers(value) { return [...new Set(value.split(/[\s,，;；]+/u).map(n => n.trim()).filter(Boolean))]; }
export function validateNumbers(numbers) {
  if (!numbers.length) return '请至少输入一个运单号。';
  if (numbers.length > 20) return '最多支持 20 个不同单号，请删除多余单号。';
  if (numbers.some(n => n.length > 100 || /[<>\x00-\x1f]/u.test(n))) return '运单号格式不正确，请检查后重试。';
  return '';
}
export function category(record) {
  if (['error', 'missing', 'unconfigured', 'ambiguous'].includes(record.state)) return 'attention';
  if (record.state !== 'success') return 'pending';
  if (record.shipment.status === 'delivered') return 'delivered';
  if (['returned', 'cancelled', 'exception', 'failed_attempt'].includes(record.shipment.status)) return 'attention';
  return 'transit';
}
export function normalizeResponse(data, number) {
  if (!data || typeof data !== 'object' || ![0, 1, '0', '1', false, true].includes(data.status)) throw new Error('原站返回了无法识别的数据，请稍后重试。');
  if (!Number(data.status)) return { number, state: 'missing', message: '众乐数据源未返回该单号的运单记录，不代表承运商没有记录。', sourceMessage: typeof data.info === 'string' ? data.info.trim() : '' };
  const s = data.data?.shipment;
  if (!s || typeof s !== 'object') throw new Error('原站返回的运单信息不完整。');
  const text = v => v === false || v === null || v === undefined ? '' : String(v);
  const shipment = Object.fromEntries(['shipment_id', 'client_reference', 'ext_number', 'outer_carrier_code', 'outer_carrier_tracking_number', 'status', 'country', 'postcode', 'parcel_count'].map(k => [k, text(s[k])]));
  shipment.traces = Array.isArray(s.traces) ? s.traces.map((t, index) => ({ time: text(t.time), info: text(t.info).trim(), index })).sort((a, b) => b.time.localeCompare(a.time) || a.index - b.index) : [];
  return { number, state: 'success', shipment };
}
export async function fetchShipment(number, signal, options = {}) {
  // This public data source supports CORS; keep its working browser-direct route.
  // Only authenticated aggregation goes through our server, so no key reaches the client.
  if (options.provider === 'zhongle' || (!options.provider || options.provider === 'auto') && /^BG\d{8,}$/i.test(number) && !options.courierCode) {
    const url = new URL(ENDPOINT); url.searchParams.set('inajax','1'); url.searchParams.set('tracking_number',number);
    const response = await fetch(url,{signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
    if(!response.ok) throw new Error(`众乐请求失败（HTTP ${response.status}）。`);
    let data; try {data=await response.json();} catch {throw new Error('众乐数据源未返回有效数据，请稍后重试。');}
    return {...normalizeResponse(data,number),source:'zhongle'};
  }
  const response = await fetch('/api/tracking', { method:'POST', signal, credentials:'same-origin', cache:'no-store', headers:{'Content-Type':'application/json'}, body:JSON.stringify({number,...options}) });
  let data; try { data = await response.json(); } catch { throw new Error('服务未返回有效数据，请确认已登录并稍后重试。'); }
  if (!response.ok) throw new Error(data.error || `请求失败（HTTP ${response.status}）。`);
  if (!data.record || data.record.number !== number) throw new Error('查询返回的数据不完整或单号不匹配。');
  return data.record;
}
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[\s]*[=+@-]/u.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function toCSV(records) {
  const rows = [['查询单号', '系统单号', '客户单号', '转单号', '状态', '国家', '邮编', '件数', '轨迹时间（原站时间）', '轨迹内容']];
  for (const r of records.filter(r => r.state === 'success')) {
    const s = r.shipment;
    for (const t of s.traces.length ? s.traces : [{ time: '', info: '' }]) rows.push([r.number, s.shipment_id, s.client_reference, s.outer_carrier_tracking_number, STATUS[s.status] || s.status, s.country, s.postcode, s.parcel_count, t.time, t.info]);
  }
  return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
