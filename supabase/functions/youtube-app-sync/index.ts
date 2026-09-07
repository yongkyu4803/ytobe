import { createClient } from 'npm:@supabase/supabase-js@2.74.0';
import { runCollection } from './collector.mjs';

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', {status:405});
  const secret = Deno.env.get('YOUTUBE_APP_SYNC_SECRET');
  if (!secret || request.headers.get('x-youtube-sync-secret') !== secret) return new Response('Unauthorized', {status:401});
  const key = Deno.env.get('YOUTUBE_APP_API_KEY');
  if (!key) return Response.json({error:'YouTube API key is not configured'}, {status:503});
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth:{persistSession:false,autoRefreshToken:false},
  });
  try {
    const results = await runCollection(db, key, {limit:3});
    return Response.json({results}, {status:results.some(r=>r.status==='failed')?207:200});
  } catch {
    return Response.json({error:'Collection could not start'}, {status:500});
  }
});
