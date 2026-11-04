import { env } from 'cloudflare:workers';
import { trackShipment } from '../../../lib/free-tracking-service.mjs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const origin=request.headers.get('origin');
  if(origin && origin!==new URL(request.url).origin) return Response.json({error:'不允许跨站查询。'},{status:403});
  const text=await request.text();
  if(text.length>8192) return Response.json({error:'请求过大。'},{status:413});
  try { return Response.json({record:await trackShipment(JSON.parse(text),env)},{headers:{'Cache-Control':'no-store'}}); }
  catch(e:any) {return Response.json({error:e.name==='SyntaxError'?'请求格式不正确。':e.code?e.message:'查询失败，请稍后重试。',code:e.code||'INVALID_REQUEST'},{status:e.status||400,headers:{'Cache-Control':'no-store'}});}
}
