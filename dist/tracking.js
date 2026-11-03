export const ENDPOINT = 'https://gzzlgj.nextsls.com/tracking/app';
export const STATUS = { ready: '已下单', picked: '已收货', in_transit: '运输中', delivered: '已签收', returned: '已退件', cancelled: '已取消' };
export function parseNumbers(value) { return [...new Set(value.split(/[\s,，;；]+/u).map(n => n.trim()).filter(Boolean))]; }
export function validateNumbers(numbers) {
  if (!numbers.length) return '请至少输入一个运单号。';
  if (numbers.length > 20) return '最多支持 20 个不同单号，请删除多余单号。';
  if (numbers.some(n => n.length > 100 || /[<>\x00-\x1f]/u.test(n))) return '运单号格式不正确，请检查后重试。';
  return '';
}
export function category(record) {
  if (['error', 'missing'].includes(record.state)) return 'attention';
  if (record.state !== 'success') return 'pending';
  if (record.shipment.status === 'delivered') return 'delivered';
  if (['returned', 'cancelled'].includes(record.shipment.status)) return 'attention';
  return 'transit';
}
export function normalizeResponse(data, number) {
  if (!data || typeof data !== 'object' || ![0, 1, '0', '1', false, true].includes(data.status)) throw new Error('原站返回了无法识别的数据，请稍后重试。');
  if (!Number(data.status)) return { number, state: 'missing', message: typeof data.info === 'string' && data.info.trim() ? data.info : '暂未查到该运单，请核对单号或稍后再试。' };
  const s = data.data?.shipment;
  if (!s || typeof s !== 'object') throw new Error('原站返回的运单信息不完整。');
  const text = v => v === false || v === null || v === undefined ? '' : String(v);
  const shipment = Object.fromEntries(['shipment_id', 'client_reference', 'ext_number', 'outer_carrier_code', 'outer_carrier_tracking_number', 'status', 'country', 'postcode', 'parcel_count'].map(k => [k, text(s[k])]));
  shipment.traces = Array.isArray(s.traces) ? s.traces.map((t, index) => ({ time: text(t.time), info: text(t.info).trim(), index })).sort((a, b) => b.time.localeCompare(a.time) || a.index - b.index) : [];
  return { number, state: 'success', shipment };
}
export async function fetchShipment(number, signal) {
  const url = new URL(ENDPOINT); url.searchParams.set('inajax', '1'); url.searchParams.set('tracking_number', number);
  const response = await fetch(url, { signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(`原站请求失败（HTTP ${response.status}），请稍后重试。`);
  let data; try { data = await response.json(); } catch { throw new Error('原站暂未返回有效数据，请稍后重试。'); }
  return normalizeResponse(data, number);
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
