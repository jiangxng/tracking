import { STATUS, parseNumbers, validateNumbers, category, fetchShipment, toCSV, carrierLink } from './tracking.js';
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
const readingSizes = ['16', '18', '20', '22'];
function setReadingSize(value) {
  const size = readingSizes.includes(value) ? value : '16';
  document.documentElement.style.setProperty('--reading-size', size + 'px');
  $('reading-size').value = size;
}
try { setReadingSize(localStorage.getItem('tracking-reading-size')); } catch { setReadingSize('16'); }
$('reading-size').addEventListener('change', e => {
  setReadingSize(e.target.value);
  try { localStorage.setItem('tracking-reading-size', e.target.value); } catch { /* 字号依然在当前页面生效。 */ }
});
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
let records = [], currentFilter = 'all', busy = false, runId = 0, controller = null, updatedAt = '', toastTimer;
const views = new Map();
let currentOptions = {};
let couriers = [];
function readQueryOptions() {
  return { provider:$('provider').value, courierCode:$('courier-code').value.trim(), destinationCountryCode:$('country-code').value.trim().toUpperCase(), destinationPostCode:$('post-code').value.trim(), shippingDate:$('shipping-date').value };
}
function renderCouriers() {
  const term=$('carrier-search').value.toLowerCase();
  const list=couriers.filter(c=>`${c.name} ${c.code} ${c.country}`.toLowerCase().includes(term));
  $('carrier-summary').textContent=`目录中有 ${couriers.length} 个入口，当前匹配 ${list.length} 个。网页抓取适配器不保证每票可查。`;
  $('carrier-results').innerHTML=list.slice(0,100).map(c=>`<div class="carrier-row"><strong>${escape(c.name)}</strong><span>${escape(c.code)} · ${c.kind==='scraper'?'网页抓取适配器':c.enabled||c.configured?'已配置':'待配置'}</span></div>`).join('')+(list.length>100?'<p>显示前 100 项，请输入关键词缩小范围。</p>':'');
}
async function loadConnection() {
  $('check-connection').disabled=true;
  try {
    const response=await fetch('/api/config',{cache:'no-store'});
    if(!response.ok) throw new Error('无法读取配置，请确认已登录。');
    const config=await response.json();
    const enabled=config.providers.filter(p=>p.enabled);
    $('service-title').textContent='免费数据源 · '+enabled.map(p=>p.name).join(' / ');
    $('service-message').textContent='已接入 '+enabled.length+' / '+config.providers.length+' 个数据源。自动查询优先使用网页抓取；抓取服务未配置时按单号尝试已授权的官方接口。';
    $('setup-status').textContent=config.providers.map(p=>p.name+'：'+(p.enabled?'已配置':'待配置')).join('；');
    $('connection-result').textContent='配置状态已更新。';
    couriers=config.providers.map(p=>({...p,code:p.id,country:'',requiredFields:[],kind:'provider'}));
    $('courier-code').disabled=busy||!['scraper','karrio'].includes($('provider').value);
    $('courier-hint').textContent='网页抓取或 Karrio 可填写承运商代码，例如 ups、usps；其他数据源留空。';
    renderCouriers();
  } catch(e) {
    $('service-title').textContent='数据源连接待检查'; $('service-message').textContent=e.message;
    $('connection-result').textContent=e.message; $('setup-status').textContent=e.message;
  } finally { $('check-connection').disabled=false; }
}
const filterDefs = [['all','全部运单','box'],['transit','运输中 / 待发','truck'],['delivered','已签收','check'],['attention','异常 / 待处理','alert']];
function notify(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 2600); }
function countInput() { const n = parseNumbers($('numbers').value).length; $('input-count').textContent = `${n} / 20 个单号`; $('input-count').style.color = n > 20 ? '#b84c40' : ''; }
function label(record) {
  if (record.state === 'success') return STATUS[record.shipment.status] || record.shipment.status || '状态未知';
  return { pending: '等待查询', loading: '正在查询', missing: '未查到', unconfigured:'数据源待配置', waiting:'等待轨迹', ambiguous:'需要补充信息', error: '查询失败', cancelled: '已停止' }[record.state];
}
function renderStats() {
  $('stats').innerHTML = filterDefs.map(([key, name, symbol]) => `<button class="stat ${key === currentFilter ? 'active' : ''}" data-filter="${key}" aria-pressed="${key === currentFilter}"><span class="stat-label">${icon(symbol)} ${name}</span><span class="stat-number">${key === 'all' ? records.length : records.filter(r => category(r) === key).length}<small>票</small></span></button>`).join('');
  $('result-count').textContent = records.length;
  $('export').disabled = !records.some(r => r.state === 'success');
  $('refresh').disabled = busy || !records.length;
  $('query').disabled = busy;
  $('cancel').hidden = !busy;
  for (const id of ['provider','country-code','post-code','shipping-date']) $(id).disabled=busy;
  $('courier-code').disabled=busy || !['scraper','karrio'].includes($('provider').value);
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
  const title = `<div class="shipment-head"><span class="shipment-icon">${icon('box')}</span><div class="shipment-name"><h3>${escape(record.number)}</h3><p>${s ? escape(s.outer_carrier_code || '国际物流') + ' · 国际货运' : (record.source ? record.source.toUpperCase()+' · 物流查询' : '物流查询')}</p></div><div class="shipment-tools"><span class="badge ${c}">${icon(badgeIcon)}${escape(label(record))}</span><button class="icon-button" data-action="copy-number" aria-label="复制单号 ${escape(record.number)}" title="复制单号">${icon('copy')}</button></div></div>`;
  if (!s) {
    const carrier = carrierLink(record.number);
    const unavailable = ['error', 'missing', 'unconfigured', 'waiting', 'ambiguous'].includes(record.state);
    return `<article class="shipment" data-index="${index}">${title}<div class="message-card"><div><p>${escape(record.message || (record.state === 'loading' ? '正在向物流数据源查询，网页抓取可能需要约 1 分钟…' : record.state === 'cancelled' ? '查询已停止，可点击刷新重新查询。' : '等待前面的运单查询完成…'))}</p>${unavailable ? `<p class="source-detail">${carrier ? '此单号符合 UPS 格式，也可前往 UPS 官网核验。' : (record.source !== 'zhongle' ? '可检查接入设置，或补充准确的承运商与目的地后重试。' : '如有对应的众乐系统单号或客户单号，可用它再次查询。')}</p>` : ''}${record.sourceMessage ? `<details class="source-detail"><summary>查看原站提示</summary>${escape(record.sourceMessage)}</details>` : ''}</div>${unavailable ? `<div class="fallback-actions">${carrier ? `<a class="primary carrier-link" href="${escape(carrier.url)}" target="_blank" rel="noopener noreferrer">${carrier.name} 官网查询 ↗</a>` : ''}<button class="secondary" data-action="retry" ${busy ? 'disabled' : ''}>重新查询</button></div>` : ''}</div>${record.state === 'loading' ? '<div class="pending-line"></div>' : ''}</article>`;
  }
  const datum = (name, value, cls = '') => `<div class="datum ${cls}"><label>${name}</label><div class="number">${escape(value || '—')}</div></div>`;
  const latest = s.traces[0];
  return `<article class="shipment" data-index="${index}">${title}<div class="shipment-info">${datum('目的国家 / 地区',s.country)}${datum('目的地邮编',s.postcode)}${datum('包裹件数',s.parcel_count ? s.parcel_count + ' 件' : '')}${datum(record.source !== 'zhongle' ? '查询单号' : '系统单号',s.shipment_id)}${record.source !== 'zhongle' ? datum('运输服务',s.service) : datum('客户单号',s.client_reference)}${datum('转单号',s.outer_carrier_tracking_number,'transfer')}${s.ext_number ? datum('外部单号',s.ext_number) : ''}${s.eta ? datum('预计送达',s.eta) : ''}</div><div class="latest">${icon(badgeIcon)}<div class="latest-content"><strong>${escape(latest?.info || s.summary || '等待物流轨迹更新')}</strong><small>${escape(latest?.time || '')}</small></div><button class="text-btn" data-action="toggle" aria-expanded="${view.expanded}" aria-controls="details-${index}">${view.expanded ? '收起轨迹' : '展开轨迹'} ${icon('chevron')}</button></div><div id="details-${index}" ${view.expanded ? '' : 'hidden'}><div class="timeline-toolbar"><strong>物流轨迹 <span>${s.traces.length} 条动态</span></strong><div class="timeline-controls"><input class="trace-search" aria-label="搜索 ${escape(record.number)} 的轨迹" placeholder="搜索轨迹" value="${escape(view.keyword)}"><button class="sort-button" data-action="sort">${view.ascending ? '↑ 最早在前' : '↓ 最新在前'}</button></div></div><ol class="timeline">${traceHTML(record, view)}</ol>${s.history_note ? `<p class="source-detail">${escape(s.history_note)}</p>` : ''}</div><div class="card-foot"><span>来源：${record.source === 'zhongle' ? '众乐国际' : record.source.toUpperCase()} · 时间按源数据原样显示</span><div><button class="text-btn" data-action="copy-link" >复制查询链接</button><span> &nbsp; / &nbsp; </span>${record.source !== 'zhongle' ? (carrierLink(record.number) ? `<a href="${carrierLink(record.number).url}" target="_blank" rel="noopener noreferrer">承运商核验 ↗</a>` : '承运商轨迹') : `<a href="https://gzzlgj.nextsls.com/tracking/app#/tracking?numbers=${encodeURIComponent(record.number)}" target="_blank" rel="noopener noreferrer">原站核验 ↗</a>`}</div></div></article>`;
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
  const attention = records.filter(r => ['unconfigured','waiting','ambiguous'].includes(r.state)).length;
  return `查询完成${attention ? ` · ${attention} 票待处理` : ''} · ${successful} 票有结果${missing ? ` · ${missing} 票未查到` : ''}${errors ? ` · ${errors} 票失败` : ''}${cancelled ? ` · ${cancelled} 票已停止` : ''}${updatedAt ? ` · ${updatedAt} 更新` : ''}`;
}
async function query(numbers, retryIndex = null) {
  if (busy) return;
  const error = validateNumbers(numbers); $('input-error').textContent = error; if (error) { $('numbers').focus(); return; }
  currentOptions = retryIndex === null ? readQueryOptions() : (records[retryIndex].queryOptions || readQueryOptions());
  const id = ++runId; busy = true; currentFilter = 'all';
  if (retryIndex === null) { records = numbers.map(number => ({ number, state: 'pending' })); views.clear(); setURL(numbers); }
  const indices = retryIndex === null ? records.map((_,i) => i) : [retryIndex];
  render();
  for (let step = 0; step < indices.length; step++) {
    if (id !== runId) break;
    const i = indices[step], number = records[i].number;
    records[i] = { number, state: 'loading', queryOptions:currentOptions }; $('query-status').textContent = `正在查询 ${step + 1} / ${indices.length} · ${number}`; render();
    controller = new AbortController(); const activeController=controller; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; activeController.abort(); }, 75000);
    try { const result = await fetchShipment(number, controller.signal, currentOptions); if (id !== runId) break; records[i] = {...result,queryOptions:currentOptions}; }
    catch (error) { if (id !== runId) break; records[i] = { number, state: 'error', queryOptions:currentOptions, message: timedOut ? '物流数据源响应超时，请稍后重试。' : error instanceof TypeError ? '暂时无法连接查询服务，请检查网络或登录状态。' : error.message }; }
    finally { clearTimeout(timer); }
    render();
    if (step < indices.length - 1) await new Promise(resolve => setTimeout(resolve, currentOptions.provider==='dhl' || currentOptions.provider==='auto' && /^\d{10}$/.test(number) ? 5000 : 1000));
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
function example() { if (busy) return; $('provider').value='zhongle'; $('numbers').value = 'BG2608182036'; countInput(); query(['BG2608182036']); }
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
$('setup').addEventListener('click',()=> $('setup-dialog').showModal());
$('close-setup').addEventListener('click',()=> $('setup-dialog').close());
$('check-connection').addEventListener('click',loadConnection);
$('provider').addEventListener('change',()=>{$('courier-code').disabled=!['scraper','karrio'].includes($('provider').value);});
$('show-carriers').addEventListener('click',async()=>{renderCouriers();$('carriers-dialog').showModal();try{const response=await fetch('/api/couriers',{cache:'no-store'});if(response.ok){const data=await response.json();if(Array.isArray(data.couriers)){couriers=data.couriers;renderCouriers();}}}catch{/* 保留基础目录。 */}});
$('close-carriers').addEventListener('click',()=> $('carriers-dialog').close());
$('carrier-search').addEventListener('input',renderCouriers);
$('courier-code').addEventListener('input',()=>{const c=couriers.find(c=>c.code===$('courier-code').value);$('courier-hint').textContent=c?.requiredFields.length?`此承运商需要：${c.requiredFields.join(' / ')}。无法提供必要信息时可能查不到结果。`:'留空自动识别，或从目录中选择承运商。';});
render(); countInput();
loadConnection();
const hashParams = new URLSearchParams(location.hash.includes('?') ? location.hash.split('?')[1] : '');
const initialNumbers = new URL(location.href).searchParams.get('numbers') || hashParams.get('numbers');
if (initialNumbers) { $('numbers').value = parseNumbers(initialNumbers).join('\n'); countInput(); query(parseNumbers(initialNumbers)); }
