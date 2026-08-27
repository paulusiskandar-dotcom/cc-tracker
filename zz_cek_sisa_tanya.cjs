const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
console.log('=== AKUN PIUTANG: kolom pembeda ===');
const rec=accounts.filter(a=>a.type==='receivable');
for(const a of rec){
  const keys=['id','name','entity','type','is_active','archived','created_at','initial_balance','current_balance','notes'];
  console.log(' ',keys.filter(k=>a[k]!==undefined&&a[k]!==null).map(k=>`${k}=${k==='id'?String(a[k]).slice(0,8):a[k]}`).join(' · '));
}
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,entity,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('\n dipakai di ledger:');
for(const a of rec)console.log(`  ${String(a.id).slice(0,8)} ${a.name.padEnd(18)} ${led.filter(r=>r.to_id===a.id||r.from_id===a.id).length} baris`);
const{data:ss}=await supabase.from('reimburse_settlements').select('id,entity').eq('user_id',uid);
console.log('\n dirujuk oleh settlement? settlement tidak menyimpan account_id — hanya entity:',[...new Set((ss||[]).map(s=>s.entity))].join(', '));

console.log('\n=== YANG MASIH BELUM KUTAHU ===');
console.log('\n1. DITAHAN — entity belum jelas (sudah pasti reimburse_out menurutmu):');
for(const a of [2678847,9693415,7731514]){
  const r=led.find(x=>Math.abs(+x.amount_idr-a)<1&&x.tx_date>='2026-01-01'&&x.tx_date<='2026-01-31'&&/tokopedia/i.test(x.description||''));
  if(r)console.log(`   ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${nm(r.from_id).padEnd(13)} tipe=${r.tx_type} | ${(r.description||'').slice(0,40)}`);
}
console.log('\n2. Tokopedia Feb–Agu yang BELUM diperiksa sama sekali:');
const tk=led.filter(r=>r.tx_type==='expense'&&/tokopedia/i.test(r.description||'')&&r.tx_date>='2026-02-01');
const m={};tk.forEach(r=>{const k=r.tx_date.slice(0,7);m[k]=m[k]||{n:0,t:0};m[k].n++;m[k].t+= +r.amount_idr;});
for(const[k,v]of Object.entries(m).sort())console.log(`   ${k}: ${String(v.n).padStart(3)} baris ${rp(v.t).padStart(13)}`);
console.log(`   TOTAL: ${tk.length} baris ${rp(tk.reduce((s,r)=>s+ +r.amount_idr,0))}`);
console.log('\n3. Angsuran cicilan Tokopedia (isi barang dari pembelian bulan sebelumnya):');
const cic=led.filter(r=>r.tx_type==='expense'&&/TOKOPEDIA.*CCL|CCL12/i.test(r.description||''));
console.log(`   ${cic.length} baris ${rp(cic.reduce((s,r)=>s+ +r.amount_idr,0))}`);
console.log('\n4. Amazon — email pesanan tidak ada di Gmail:');
const az=led.filter(r=>r.tx_type==='expense'&&/AMAZON/i.test(r.description||''));
console.log(`   ${az.length} baris ${rp(az.reduce((s,r)=>s+ +r.amount_idr,0))}`);
console.log('\n5. Sisa Online Shopping selain Tokopedia/Amazon:');
const os=led.filter(r=>r.category_name==='Online Shopping'&&!/tokopedia|amazon/i.test(r.description||''));
const byo={};os.forEach(r=>{const k=(r.description||'?').toUpperCase().slice(0,22);byo[k]=(byo[k]||0)+ +r.amount_idr;});
for(const[k,v]of Object.entries(byo).sort((a,b)=>b[1]-a[1]).slice(0,10))console.log(`   ${rp(v).padStart(11)}  ${k}`);
console.log(`   TOTAL: ${os.length} baris ${rp(os.reduce((s,r)=>s+ +r.amount_idr,0))}`);
process.exit(0);})();
