import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getCouriers, publicConfig, trackShipment } from '../lib/free-tracking-service.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 8081);
const assets = new Map([
  ['/', ['app/site.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/tracking.js', ['public/tracking.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/readability.css', ['public/readability.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['public/favicon.svg', 'image/svg+xml']],
]);
const buckets = new Map();
let activeQueries = 0;

function json(response, status, body, cache = 'no-store') {
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':cache,'X-Content-Type-Options':'nosniff'});
  response.end(JSON.stringify(body));
}

function allowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === request.headers.host && (parsed.protocol === 'https:' || parsed.protocol === 'http:');
  } catch { return false; }
}

function limited(request) {
  const forwarded = request.headers['x-forwarded-for'];
  const address = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
  const bucket = buckets.get(address);
  if (bucket && bucket.count >= 30) return true;
  if (bucket) bucket.count += 1;
  else buckets.set(address, {count:1, until:now + 60_000});
  return false;
}

const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname === '/health' && request.method === 'GET') return json(response, 200, {ok:true, service:'tracking'});
    if (pathname === '/api/config' && request.method === 'GET') return json(response, 200, publicConfig(process.env));
    if (pathname === '/api/couriers' && request.method === 'GET') return json(response, 200, await getCouriers(process.env), 'private, max-age=300');
    if (pathname === '/api/tracking' && request.method === 'POST') {
      if (!allowedOrigin(request)) return json(response, 403, {error:'不允许跨站查询。'});
      if (limited(request) || activeQueries >= 4) return json(response, 429, {error:'查询过于频繁，请稍后重试。'});
      activeQueries += 1;
      try {
        let body = '';
        for await (const chunk of request) {
          body += chunk.toString('utf8');
          if (body.length > 8192) return json(response, 413, {error:'请求过大。'});
        }
        try { return json(response, 200, {record:await trackShipment(JSON.parse(body), process.env)}); }
        catch (error) { return json(response, error.status || 400, {error:error.name === 'SyntaxError' ? '请求格式不正确。' : error.code ? error.message : '查询失败，请稍后重试。',code:error.code || 'INVALID_REQUEST'}); }
      } finally { activeQueries -= 1; }
    }
    if (request.method === 'GET' && assets.has(pathname)) {
      const [relative, type] = assets.get(pathname);
      const content = await readFile(path.join(root, relative));
      response.writeHead(200, {'Content-Type':type,'Cache-Control':pathname === '/' ? 'no-store' : 'public, max-age=300','X-Content-Type-Options':'nosniff'});
      return response.end(content);
    }
    json(response, 404, {error:'页面不存在。'});
  } catch (error) {
    console.error('tracking request failed', error?.message || error);
    if (!response.headersSent) json(response, 500, {error:'服务暂时不可用。'});
    else response.end();
  }
});
server.requestTimeout = 75_000;
server.listen(port, '0.0.0.0', () => console.log(`tracking listening on ${port}`));
