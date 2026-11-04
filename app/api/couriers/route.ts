import { env } from 'cloudflare:workers';
import { getCouriers } from '../../../lib/free-tracking-service.mjs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {return Response.json(await getCouriers(env),{headers:{'Cache-Control':'private, max-age=300'}});}
  catch(e:any) {return Response.json({error:e.code?e.message:'无法加载承运商目录。'},{status:e.status||502,headers:{'Cache-Control':'no-store'}});}
}
