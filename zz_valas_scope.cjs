const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const fx=accounts.filter(a=>a.currency&&a.currency!=='IDR');
console.log('=== akun non-IDR ===');
for(const a of fx)console.log(` ${a.name.padEnd(14)} ${a.currency} tipe=${a.type} initial=${a.initial_balance} current=${a.current_balance}`);
const fxIds=new Set(fx.map(a=>a.id));
const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount,amount_idr,currency,fx_rate_used,from_id,from_type,to_id,to_type,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const touch=led.filter(r=>(fxIds.has(r.from_id)&&r.from_type==='account')||(fxIds.has(r.to_id)&&r.to_type==='account'));
console.log('\n=== baris ledger yg menyentuh akun non-IDR:',touch.length,'===');
const byc={};
for(const r of touch){const c=r.currency||'(null)';byc[c]=byc[c]||{n:0,amt:0,idr:0,fx:0,exp:0};
  byc[c].n++;byc[c].amt+= +r.amount;byc[c].idr+= +r.amount_idr;if(r.fx_rate_used)byc[c].fx++;
  if(r.tx_type==='expense')byc[c].exp++;}
console.log('cur  | baris | jml amount | jml amount_idr | ada fx_rate | expense');
for(const[c,v]of Object.entries(byc))console.log(` ${c.padEnd(5)}| ${String(v.n).padStart(5)} | ${rp(v.amt).padStart(12)} | ${rp(v.idr).padStart(14)} | ${String(v.fx).padStart(11)} | ${v.exp}`);
// berapa yg amount_idr == amount (tidak dikonversi)
const same=touch.filter(r=>Math.abs(+r.amount_idr-+r.amount)<1&&(r.currency&&r.currency!=='IDR'));
console.log('\nbaris dgn amount_idr == amount (tidak dikonversi):',same.length,'dari',touch.length);
const expSame=same.filter(r=>r.tx_type==='expense');
console.log(' di antaranya expense:',expSame.length,'| total amount_idr tercatat:',rp(expSame.reduce((s,r)=>s+ +r.amount_idr,0)));
const RATE={JPY:114,SGD:11900,EUR:19900,USD:16300};
let est=0;for(const r of expSame)est+=(+r.amount)*(RATE[r.currency]||0);
console.log(' estimasi nilai rupiah sebenarnya (kurs kasar JPY114/SGD11.900/EUR19.900): ±',rp(est));
console.log('\n=== rincian per akun ===');
for(const a of fx){
  const t=touch.filter(r=>r.from_id===a.id||r.to_id===a.id);
  const e=t.filter(r=>r.tx_type==='expense');
  console.log(` ${a.name.padEnd(14)} ${a.currency}: ${t.length} baris, ${e.length} expense, expense dlm ${a.currency} = ${rp(e.reduce((s,r)=>s+ +r.amount,0))}, tercatat di Reports sbg Rp ${rp(e.reduce((s,r)=>s+ +r.amount_idr,0))}`);
}
// bagaimana net worth memperlakukan saldo akun ini?
console.log('\n=== cek utils: apakah saldo valas dikonversi utk net worth? ===');
const u=fs.readFileSync('src/utils.js','utf8');
const m=u.match(/FX_RATES?[\s\S]{0,260}/);console.log(m?m[0].slice(0,260):'(tidak ada konstanta FX_RATES di utils.js)');
process.exit(0);})();
