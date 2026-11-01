import { createClient } from 'npm:@supabase/supabase-js@2.74.0';
import { runExplore } from './explore.mjs';

const JOBS = new Set(['discover', 'stats', 'shorts']);

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', {status:405});
  const secret = Deno.env.get('YOUTUBE_APP_SYNC_SECRET');
  if (!secret || request.headers.get('x-youtube-sync-secret') !== secret) return new Response('Unauthorized', {status:401});
  const key = Deno.env.get('YOUTUBE_APP_API_KEY');
  if (!key) return Response.json({error:'YouTube API key is not configured'}, {status:503});
  const body = await request.json().catch(() => ({}));
  const job = typeof body?.job === 'string' ? body.job : '';
  if (!JOBS.has(job)) return Response.json({error:'Unknown explore job'}, {status:400});
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth:{persistSession:false,autoRefreshToken:false},
  });
  try {
    const result = await runExplore(db, key, job);
    return Response.json(result, {status:result.status === 'failed' ? 207 : 200});
  } catch {
    return Response.json({error:'Explore job could not start'}, {status:500});
  }
});
