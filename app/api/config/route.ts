import { env } from 'cloudflare:workers';
import { publicConfig } from '../../../lib/free-tracking-service.mjs';
export const dynamic = 'force-dynamic';
export function GET() {return Response.json(publicConfig(env),{headers:{'Cache-Control':'no-store'}});}
