const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const acc=await accountsApi.getAll(uid);const nm=id=>acc.find(x=>x.id===id)?.name||'—';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const RE=/ANNUAL FEE|IURAN TAHUNAN|FEE TAHUNAN|WAIVER|REVERSAL|KOR BIAYA/i;
const rows=led.filter(r=>RE.test(r.description||''));
console.log('=== semua baris annual fee / waiver / reversal ===');
const perKartu={};
for(const r of rows){
  const kartu=nm(r.from_id)!=='—'?nm(r.from_id):nm(r.to_id);
  const balik=/WAIVER|REVERSAL|KOR /i.test(r.description||'')||r.tx_type==='income';
  perKartu[kartu]=perKartu[kartu]||{fee:0,balik:0,baris:[]};
  perKartu[kartu][balik?'balik':'fee']+= +r.amount_idr;
  perKartu[kartu].baris.push(`${r.tx_date} ${balik?'−':'+'}${rp(r.amount_idr).padStart(10)} ${r.tx_type.padEnd(8)} ${(r.description||'').slice(0,44)}`);
}
let tf=0,tb=0;
for(const[k,v]of Object.entries(perKartu).sort((x,y)=>y[1].fee-x[1].fee)){
  tf+=v.fee; tb+=v.balik;
  const sisa=v.fee-v.balik;
  console.log(`\n  ${k}  fee ${rp(v.fee)} − dikembalikan ${rp(v.balik)} = ${rp(sisa)}${sisa>0&&v.balik===0?'   <<< belum ada waiver':''}`);
  for(const b of v.baris)console.log('     '+b);
}
console.log(`\n  TOTAL fee ${rp(tf)} | dikembalikan ${rp(tb)} | bersih ${rp(tf-tb)}`);
process.exit(0);})();
