const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const NOISE=/^(backfill|statement |imported from|migrated|auto|ipl\/internet)/i;
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:h}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,category_name,notes,description').eq('user_id',uid)
  .gte('tx_date','2026-08-01').lte('tx_date','2026-08-31').ilike('description','%tokopedia%').order('tx_date');
const guna=r=>{const n=(r.notes||'').trim();return n&&!NOISE.test(n);};
console.log(`Tokopedia Agustus: ${(h||[]).length} baris · ada deskripsi ${(h||[]).filter(guna).length}`);
for(const r of h||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} ${nm(r.from_id).padEnd(13)} ${guna(r)?'✓ '+r.notes.slice(0,40):'✗ belum ada'}`);
process.exit(0);})();
