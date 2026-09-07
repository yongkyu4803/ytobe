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
    const body = await request.json().catch(() => ({}));
    const requestedId = typeof body?.fullSyncId === 'string' ? body.fullSyncId : null;
    if(requestedId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedId)) {
      return Response.json({error:'Invalid full collection id'}, {status:400});
    }
    let fullSyncId = requestedId;
    if(!fullSyncId) {
      const active = await db.rpc('youtube_app_active_full_sync');
      if(active.error) throw active.error;
      fullSyncId = active.data || null;
    }
    const results = await runCollection(db, key, {limit:3,fullSyncId,delayMs:fullSyncId?500:0});
    return Response.json({results,fullSyncId}, {status:results.some(r=>r.status==='failed')?207:200});
  } catch {
    return Response.json({error:'Collection could not start'}, {status:500});
  }
});
