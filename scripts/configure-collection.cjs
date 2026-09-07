// Setup only this app's Edge secrets + Vault entries. Never prints secret values.
const {loadEnvConfig}=require('@next/env');
const {randomBytes}=require('node:crypto');
const {mkdtempSync,writeFileSync,readFileSync,rmSync,chmodSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {spawnSync}=require('node:child_process');
loadEnvConfig(process.cwd());
const url=process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.YOUTUBE_API_KEY;
if(!url||!key)throw Error('Supabase URL and YouTube key are required');
const ref=new URL(url).hostname.split('.')[0];
const secret=process.env.YOUTUBE_APP_SYNC_SECRET || randomBytes(32).toString('hex');
const temp=mkdtempSync(join(tmpdir(),'youtube-app-setup-'));chmodSync(temp,0o700);
function run(args){const result=spawnSync('supabase',args,{encoding:'utf8'});if(result.status!==0)throw Error(`Supabase ${args[0]} failed. No secret output has been printed.`);}
try {
  const envFile=join(temp,'secrets.env');
  writeFileSync(envFile,`YOUTUBE_APP_API_KEY=${key}\nYOUTUBE_APP_SYNC_SECRET=${secret}\n`,{mode:0o600});
  run(['secrets','set','--project-ref',ref,'--env-file',envFile]);
  const quote=v=>"'"+v.replaceAll("'","''")+"'";
  const sqlFile=join(temp,'vault.sql');
  const secrets=[['youtube_app_sync_url',url+'/functions/v1/youtube-app-sync'],['youtube_app_sync_token',secret]];
  writeFileSync(sqlFile,'BEGIN;\n'+secrets.map(([name,value])=>`DO $setup$ DECLARE existing uuid; BEGIN
    SELECT id INTO existing FROM vault.secrets WHERE name=${quote(name)};
    IF existing IS NULL THEN PERFORM vault.create_secret(${quote(value)},${quote(name)});
    ELSE PERFORM vault.update_secret(existing,${quote(value)}); END IF;
  END $setup$;`).join('\n')+'\nCOMMIT;',{mode:0o600});
  run(['db','query','--linked','--file',sqlFile]);
  let local=readFileSync('.env.local','utf8');
  if(!/^YOUTUBE_APP_SYNC_SECRET=/m.test(local))local+=`\nYOUTUBE_APP_SYNC_SECRET=${secret}\n`;
  writeFileSync('.env.local',local,{mode:0o600});chmodSync('.env.local',0o600);
  console.log('Configured app-specific Edge secrets, Vault entries and local worker connection.');
} finally {rmSync(temp,{recursive:true,force:true});}
