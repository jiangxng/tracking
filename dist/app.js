import { STATUS, parseNumbers, validateNumbers, category, fetchShipment, toCSV } from './tracking.js';
const paths = {
  box: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5M12 13v9M7 5.8l9 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16h.01"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/>',
  link: '<path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  refresh: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  truck: '<path d="M2 5h12v12H2V5Zm12 5h4l4 5v2h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.box}</svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = id => document.getElementById(id);
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
let records = [], currentFilter = 'all', busy = false, runId = 0, controller = null, updatedAt = '', toastTimer;
const views = new Map();
const filterDefs = [['all','全部运单','box'],['transit','运输中 / 待发','truck'],['delivered','已签收','check'],['attention','异常 / 未查到','alert']];
function notify(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 2600); }
function countInput() { const n = parseNumbers($('numbers').value).length; $('input-count').textContent = `${n} / 20 个单号`; $('input-count').style.color = n > 20 ? '#b84c40' : ''; }
function label(record) {
  if (record.state === 'success') return STATUS[record.shipment.status] || record.shipment.status || '状态未知';
  return { pending: '等待查询', loading: '正在查询', missing: '未查到', error: '查询失败', cancelled: '已停止' }[record.state];
}
function renderStats() {
  $('stats').innerHTML = filterDefs.map(([key, name, symbol]) => `<button class="stat ${key === currentFilter ? 'active' : ''}" data-filter="${key}" aria-pressed="${key === currentFilter}"><span class="stat-label">${icon(symbol)} ${name}</span><span class="stat-number">${key === 'all' ? records.length : records.filter(r => category(r) === key).length}<small>票</small></span></button>`).join('');
  $('result-count').textContent = records.length;
  $('export').disabled = !records.some(r => r.state === 'success');
  $('refresh').disabled = busy || !records.length;
  $('query').disabled = busy;
  $('cancel').hidden = !busy;
  $('numbers').disabled = busy; $('example').disabled = busy; $('clear').disabled = busy;
}
function traceHTML(record, view) {
  const traces = record.shipment.traces;
  const filtered = traces.filter(t => `${t.time} ${t.info}`.toLowerCase().includes(view.keyword.toLowerCase()));
  const sorted = view.ascending ? [...filtered].reverse() : filtered;
  if (!sorted.length) return '<li class="trace-empty">' + (traces.length ? '没有符合关键词的轨迹' : '暂无轨迹记录，等待承运商更新') + '</li>';
  return sorted.map(t => {
    const isLatest = t === traces[0]; const [day, time = ''] = t.time.split(' ');
    return `<li class="event ${isLatest ? 'newest' : ''}"><time class="event-time"><strong>${escape(day || '时间未知')}</strong><small>${escape(time)}</small></time><div class="event-line"><span class="event-dot"></span></div><div class="event-text">${escape(t.info || '暂无描述')}${isLatest ? '<span class="new-label">最新</span>' : ''}</div></li>`;
  }).join('');
}
function cardHTML(record, index) {
  const c = category(record), s = record.shipment;
  const view = views.get(record.number) || { expanded: true, ascending: false, keyword: '' }; views.set(record.number, view);
  const badgeIcon = c === 'delivered' ? 'check' : c === 'attention' ? 'alert' : c === 'transit' ? 'truck' : 'clock';
  const title = `<div class="shipment-head"><span class="shipment-icon">${icon('box')}</span><div class="shipment-name"><h3>${escape(record.number)}</h3><p>${s ? escape(s.outer_carrier_code || '国际物流') + ' · 国际货运' : '众乐国际 · 物流查询'}</p></div><div class="shipment-tools"><span class="badge ${c}">${icon(badgeIcon)}${escape(label(record))}</span><button class="icon-button" data-action="copy-number" aria-label="复制单号 ${escape(record.number)}" title="复制单号">${icon('copy')}</button></div></div>`;
  if (!s) return `<article class="shipment" data-index="${index}">${title}<div class="message-card"><span>${escape(record.message || (record.state === 'loading' ? '正在从原站获取最新物流轨迹…' : record.state === 'cancelled' ? '查询已停止，可点击刷新重新查询。' : '等待前面的运单查询完成…'))}</span>${['error','missing'].includes(record.state) ? `<button class="secondary" data-action="retry" ${busy ? 'disabled' : ''}>重试</button>` : ''}</div>${record.state === 'loading' ? '<div class="pending-line"></div>' : ''}</article>`;
  const datum = (name, value, cls = '') => `<div class="datum ${cls}"><label>${name}</label><div class="number">${escape(value || '—')}</div></div>`;
  const latest = s.traces[0];
  return `<article class="shipment" data-index="${index}">${title}<div class="shipment-info">${datum('目的国家 / 地区',s.country)}${datum('目的地邮编',s.postcode)}${datum('包裹件数',s.parcel_count ? s.parcel_count + ' 件' : '')}${datum('系统单号',s.shipment_id)}${datum('客户单号',s.client_reference)}${datum('转单号',s.outer_carrier_tracking_number,'transfer')}${s.ext_number ? datum('外部单号',s.ext_number) : ''}</div><div class="latest">${icon(badgeIcon)}<div class="latest-content"><strong>${escape(latest?.info || '等待物流轨迹更新')}</strong><small>${escape(latest?.time || '')}</small></div><button class="text-btn" data-action="toggle" aria-expanded="${view.expanded}" aria-controls="details-${index}">${view.expanded ? '收起轨迹' : '展开轨迹'} ${icon('chevron')}</button></div><div id="details-${index}" ${view.expanded ? '' : 'hidden'}><div class="timeline-toolbar"><strong>物流轨迹 <span>${s.traces.length} 条动态</span></strong><div class="timeline-controls"><input class="trace-search" aria-label="搜索 ${escape(record.number)} 的轨迹" placeholder="搜索轨迹" value="${escape(view.keyword)}"><button class="sort-button" data-action="sort">${view.ascending ? '↑ 最早在前' : '↓ 最新在前'}</button></div></div><ol class="timeline">${traceHTML(record, view)}</ol></div><div class="card-foot"><span>时间按原站显示 · 未提供时区</span><div><button class="text-btn" data-action="copy-link" style="font-size:9px">复制查询链接</button><span> &nbsp; / &nbsp; </span><a href="https://gzzlgj.nextsls.com/tracking/app#/tracking?numbers=${encodeURIComponent(record.number)}" target="_blank" rel="noopener noreferrer">原站核验 ↗</a></div></div></article>`;
}
function render() {
  renderStats();
  const visible = records.map((r,i) => [r,i]).filter(([r]) => currentFilter === 'all' || category(r) === currentFilter);
  $('result-list').innerHTML = visible.length ? visible.map(([r,i]) => cardHTML(r,i)).join('') : `<div class="empty-state"><div><span class="empty-mark">${icon(records.length ? 'check' : 'box')}</span><h3>${records.length ? '该状态下暂无运单' : '你的货物，正在去往哪里？'}</h3><p>${records.length ? '切换其他状态，查看本次查询的全部结果。' : '输入运单号，查看最新运输状态与完整物流轨迹。'}</p><button class="secondary" data-empty-action="${records.length ? 'all' : 'example'}">${records.length ? '查看全部运单' : '查看参考运单 →'}</button></div></div>`;
}
function setURL(numbers) { const url = new URL(location.href); url.hash = ''; if (numbers.length) url.searchParams.set('numbers', numbers.join(',')); else url.searchParams.delete('numbers'); history.replaceState(null, '', url); }
function completionText() {
  const successful = records.filter(r => r.state === 'success').length;
  const missing = records.filter(r => r.state === 'missing').length;
  const errors = records.filter(r => r.state === 'error').length;
  const cancelled = records.filter(r => r.state === 'cancelled').length;
  return `查询完成 · ${successful} 票有结果${missing ? ` · ${missing} 票未查到` : ''}${errors ? ` · ${errors} 票失败` : ''}${cancelled ? ` · ${cancelled} 票已停止` : ''}${updatedAt ? ` · ${updatedAt} 更新` : ''}`;
}
async function query(numbers, retryIndex = null) {
  if (busy) return;
  const error = validateNumbers(numbers); $('input-error').textContent = error; if (error) { $('numbers').focus(); return; }
  const id = ++runId; busy = true; currentFilter = 'all';
  if (retryIndex === null) { records = numbers.map(number => ({ number, state: 'pending' })); views.clear(); setURL(numbers); }
  const indices = retryIndex === null ? records.map((_,i) => i) : [retryIndex];
  render();
  for (let step = 0; step < indices.length; step++) {
    if (id !== runId) break;
    const i = indices[step], number = records[i].number;
    records[i] = { number, state: 'loading' }; $('query-status').textContent = `正在查询 ${step + 1} / ${indices.length} · ${number}`; render();
    controller = new AbortController(); let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller?.abort(); }, 30000);
    try { const result = await fetchShipment(number, controller.signal); if (id !== runId) break; records[i] = result; }
    catch (error) { if (id !== runId) break; records[i] = { number, state: 'error', message: timedOut ? '原站响应超时，请稍后重试。' : error instanceof TypeError ? '暂时无法连接原站，请检查网络或前往原站查询。' : error.message }; }
    finally { clearTimeout(timer); }
    render();
    if (step < indices.length - 1) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (id !== runId) return;
  controller = null; busy = false; updatedAt = new Date().toLocaleTimeString('zh-CN', { hour12: false }); $('query-status').textContent = completionText(); render();
}
function stopQuery() {
  ++runId; controller?.abort(); controller = null; busy = false;
  records = records.map(r => ['pending','loading'].includes(r.state) ? { ...r, state:'cancelled' } : r);
  $('query-status').textContent = '查询已停止 · 已完成的结果已保留'; render();
}
async function copy(text) { try { await navigator.clipboard.writeText(text); notify('已复制到剪贴板'); } catch { notify('浏览器未允许复制，请手动选中内容复制'); } }
$('numbers').addEventListener('input', () => { countInput(); $('input-error').textContent = ''; });
$('query-form').addEventListener('submit', e => { e.preventDefault(); query(parseNumbers($('numbers').value)); });
$('numbers').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); query(parseNumbers($('numbers').value)); } });
$('clear').addEventListener('click', () => { $('numbers').value = ''; records = []; currentFilter = 'all'; updatedAt = ''; $('input-error').textContent = ''; $('query-status').textContent = '输入运单号，开始追踪你的货物'; setURL([]); countInput(); render(); $('numbers').focus(); });
function example() { if (busy) return; $('numbers').value = 'BG2608182036'; countInput(); query(['BG2608182036']); }
$('example').addEventListener('click', example);
$('cancel').addEventListener('click', stopQuery);
$('refresh').addEventListener('click', () => query(records.map(r => r.number)));
$('stats').addEventListener('click', e => { const b = e.target.closest('[data-filter]'); if (b) { currentFilter = b.dataset.filter; render(); } });
$('result-list').addEventListener('click', e => {
  const empty = e.target.closest('[data-empty-action]'); if (empty) { if (empty.dataset.emptyAction === 'example') example(); else { currentFilter = 'all'; render(); } return; }
  const b = e.target.closest('[data-action]'); if (!b) return;
  const i = Number(b.closest('[data-index]').dataset.index), r = records[i], view = views.get(r.number);
  switch(b.dataset.action) {
    case 'toggle': view.expanded = !view.expanded; render(); break;
    case 'sort': view.ascending = !view.ascending; render(); break;
    case 'copy-number': copy(r.number); break;
    case 'copy-link': { const url = new URL(location.href); url.hash = ''; url.searchParams.set('numbers', r.number); copy(url.href); break; }
    case 'retry': query([r.number], i); break;
  }
});
$('result-list').addEventListener('input', e => { if (!e.target.matches('.trace-search')) return; const article = e.target.closest('[data-index]'), r = records[Number(article.dataset.index)], view = views.get(r.number); view.keyword = e.target.value; article.querySelector('.timeline').innerHTML = traceHTML(r, view); });
$('export').addEventListener('click', () => { const blob = new Blob([toCSV(records)], { type:'text/csv;charset=utf-8;' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `物流轨迹-${new Date().toISOString().slice(0,10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); notify('已导出本次查询成功的全部运单轨迹'); });
$('help').addEventListener('click', () => $('help-dialog').showModal());
for (const id of ['close-help','help-done']) $(id).addEventListener('click', () => $('help-dialog').close());
render(); countInput();
const hashParams = new URLSearchParams(location.hash.includes('?') ? location.hash.split('?')[1] : '');
const initialNumbers = new URL(location.href).searchParams.get('numbers') || hashParams.get('numbers');
if (initialNumbers) { $('numbers').value = parseNumbers(initialNumbers).join('\n'); countInput(); query(parseNumbers(initialNumbers)); }
