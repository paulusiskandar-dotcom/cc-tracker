const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let st=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger_staging').select('account_id,tx_date,amount,direction,description').eq('user_id',uid).lt('tx_date','2026-01-01').order('tx_date').range(off,off+999);st=st.concat(c||[]);if(!c||c.length<1000)break;}
const bcar=accounts.find(a=>a.name==='BCA R');
console.log('=== uang MASUK ke BCA R selama Desember (pola penggantian Hamasa) ===');
const masuk=st.filter(r=>r.account_id===bcar?.id&&r.direction==='in');
let tot=0;
for(const r of masuk){tot+= +r.amount;console.log(`  ${r.tx_date} ${rp(r.amount).padStart(13)} | ${(r.description||'').slice(0,58)}`);}
console.log(`  TOTAL masuk BCA R Desember: ${rp(tot)}`);
console.log('\n=== bandingkan dgn pola Januari (bulan pertama di buku) ===');
const{data:jan}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,entity,description').eq('user_id',uid).eq('tx_type','reimburse_in').eq('entity','Hamasa').gte('tx_date','2026-01-01').lte('tx_date','2026-01-31').order('tx_date');
let tj=0;for(const r of jan||[]){tj+= +r.amount_idr;console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(13)} | ${(r.description||'').slice(0,54)}`);}
console.log(`  TOTAL reimburse_in Hamasa Januari: ${rp(tj)}`);
console.log('\n=== hitungan piutang pembuka 1 Jan (perkiraan) ===');
const POLA=/LAZADA|TOKOPEDIA|DIGITALOCEAN|GLOBAL DIGITAL|XENDI/i;
const keluar=st.filter(r=>POLA.test(r.description||'')&&r.direction==='out').reduce((s,r)=>s+ +r.amount,0);
console.log(`  talangan Desember berpola piutang : ${rp(keluar).padStart(14)}`);
console.log(`  penggantian masuk BCA R Desember  : ${rp(tot).padStart(14)}`);
console.log(`  selisih (perkiraan piutang pembuka): ${rp(keluar-tot).padStart(14)}`);
console.log(`\n  ketimpangan nyata Hamasa Jan–Agu   : ${rp(396902455).padStart(14)}`);
process.exit(0);})();
