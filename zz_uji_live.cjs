// UJI LIVE: panggil edge function gmail-sync yang SUDAH TER-DEPLOY dengan
// reprocess_ids pada satu baris berstatus "skipped" (aman — tidak masuk antrean
// impor), buktikan paper_split menempel, lalu KEMBALIKAN isi aslinya.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const ID='77713829-ae0f-47c8-b0cd-934eb8598971';
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});
const uid=auth.user.id, jwt=auth.session.access_token;
const{data:before}=await supabase.from('email_sync').select('id,subject,status,ai_raw_result').eq('id',ID).single();
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/uji-live-${Date.now()}.json`,JSON.stringify(before,null,2));
console.log('baris uji:',before.subject.slice(0,44),'| status',before.status);
console.log('sebelum → pecahan:',(before.ai_raw_result||[]).map(t=>t.paper_split?'ADA':'belum').join(', '));
const url=`${env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-sync`;
const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt}`,apikey:env.REACT_APP_SUPABASE_ANON_KEY},
  body:JSON.stringify({user_id:uid,reprocess_ids:[ID]})});
console.log('\npanggil edge function →',res.status,(await res.text()).slice(0,120));
const{data:after}=await supabase.from('email_sync').select('ai_raw_result,status').eq('id',ID).single();
console.log('\nsesudah:');
let ketemu=false;
for(const t of after.ai_raw_result||[]){
  const a=Math.round(Number(t.amount_idr||t.amount||0));
  if(t.paper_split){ketemu=true;
    console.log(`  ✓ ${rp(a)} → pecahan kirim ${rp(t.paper_split.kirim)} + fee ${rp(t.paper_split.fee)} (total ${rp(t.paper_split.total)}) | ${t.paper_split.ke}`);}
  else console.log(`  – ${rp(a)} tanpa pecahan | ${(t.merchant_name||t.description||'').slice(0,40)}`);
}
await supabase.from('email_sync').update({ai_raw_result:before.ai_raw_result,status:before.status}).eq('id',ID);
const{data:pulih}=await supabase.from('email_sync').select('status,ai_raw_result').eq('id',ID).single();
console.log('\ndikembalikan → status',pulih.status,'| baris',(pulih.ai_raw_result||[]).length,
  JSON.stringify(pulih.ai_raw_result)===JSON.stringify(before.ai_raw_result)?'✓ isi identik':'✗ BEDA');
console.log('\n'+(ketemu?'LULUS — edge function ter-deploy memasang pecahan Paper':'GAGAL — pecahan tidak menempel'));
process.exit(ketemu?0:1);})();
