// Isi amount_idr utk transaksi rekening valas yg tidak pernah dikonversi.
// Kurs HANYA dari catatan Paulus sendiri: kurs yg tercetak di statement kartu,
// dan transaksi tukar valas di ledger. Tidak ada kurs karangan.
// DRY-RUN default; --apply utk menulis.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const days=(a,b)=>Math.abs(new Date(a)-new Date(b))/864e5;
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const fxAcc=accounts.filter(a=>a.currency&&a.currency!=='IDR');
const fxIds=new Set(fxAcc.map(a=>a.id));const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount,amount_idr,currency,fx_rate_used,from_id,from_type,to_id,to_type,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}

// ── 1. kumpulkan kurs dari catatan sendiri ──────────────────────────────
const obs=[]; // {cur,date,rate,src}
const RE={JPY:[/JPY\s*[\d.,]+\s*@\s*([\d.,]+)/i],
          EUR:[/\(?\s*1\s*EUR\s*=\s*(?:IDR\s*)?([\d.,]+)/i,/EUR\s*1\s*=\s*IDR\s*([\d.,]+)/i],
          SGD:[/1\s*SGD\s*=\s*(?:IDR\s*)?([\d.,]+)/i,/1SGD\s*=\s*IDR\s*([\d.,]+)/i]};
for(const r of led){const d=r.description||'';
  for(const[cur,res]of Object.entries(RE))for(const re of res){const m=d.match(re);
    if(m){const v=parseFloat(m[1].replace(/,/g,''));if(v>1)obs.push({cur,date:r.tx_date,rate:v,src:'statement kartu'});break;}}}
// dari transaksi tukar valas
for(const r of led.filter(r=>r.tx_type==='fx_exchange')){
  const toC=accounts.find(a=>a.id===r.to_id)?.currency, frC=accounts.find(a=>a.id===r.from_id)?.currency;
  const k=Number(r.fx_rate_used||0);if(!k)continue;
  if(frC==='IDR'&&toC&&toC!=='IDR')obs.push({cur:toC,date:r.tx_date,rate:k,src:'tukar valas sendiri'});
  else if(toC==='IDR'&&frC&&frC!=='IDR')obs.push({cur:frC,date:r.tx_date,rate:1/k,src:'tukar valas sendiri'});
}
const byCur={};obs.forEach(o=>{(byCur[o.cur]=byCur[o.cur]||[]).push(o);});
console.log('kurs tersedia dari catatan sendiri:');
for(const[c,v]of Object.entries(byCur)){const rr=v.map(x=>x.rate);
  console.log(`  ${c}: ${v.length} pengamatan, ${Math.min(...rr).toFixed(2)}–${Math.max(...rr).toFixed(2)}, ${v[0].date} s/d ${v[v.length-1].date}`);}

// ── 2. baris yg perlu diperbaiki ────────────────────────────────────────
const bad=led.filter(r=>fxIds.has(r.from_id)&&r.from_type==='account'&&r.currency&&r.currency!=='IDR'
  &&Math.abs(+r.amount_idr-+r.amount)<1&&!r.fx_rate_used&&r.tx_type!=='fx_exchange');
console.log('\nbaris perlu konversi:',bad.length);
const pick=(cur,date)=>{const c=(byCur[cur]||[]).slice().sort((a,b)=>days(a.date,date)-days(b.date,date));return c[0]||null;};
const plan=[];let unres=0;
for(const r of bad){const o=pick(r.currency,r.tx_date);
  if(!o){unres++;console.log('  TIDAK ADA KURS:',r.tx_date,r.currency,r.amount);continue;}
  plan.push({r,rate:o.rate,src:o.src,gap:days(o.date,r.tx_date),rdate:o.date,idr:(+r.amount)*o.rate});}
console.log('bisa dikonversi:',plan.length,'| tanpa kurs:',unres);
console.log('\ncontoh (10 baris pertama):');
for(const p of plan.slice(0,10))console.log(`  ${p.r.tx_date} ${String(p.r.amount).padStart(8)} ${p.r.currency} × ${String(p.rate).padStart(9)} = Rp ${rp(p.idr).padStart(10)}  [kurs ${p.rdate}, ${p.gap}h, ${p.src}] ${(p.r.description||'').slice(0,26)}`);
const g={};plan.forEach(p=>{const m=p.r.tx_date.slice(0,7);g[m]=g[m]||{n:0,now:0,fix:0};g[m].n++;g[m].now+= +p.r.amount_idr;g[m].fix+=p.idr;});
console.log('\nper bulan:');let T=0;
for(const[m,v]of Object.entries(g).sort()){console.log(`  ${m}: ${String(v.n).padStart(3)} baris, Rp ${rp(v.now).padStart(9)} → Rp ${rp(v.fix).padStart(12)}  (+${rp(v.fix-v.now)})`);T+=v.fix-v.now;}
console.log('  TOTAL tambahan belanja: Rp',rp(T));
const maxGap=Math.max(...plan.map(p=>p.gap));
console.log('\njarak kurs terjauh:',maxGap,'hari');
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply untuk menulis.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
const bk=`.backups/valas_idr_${Date.now()}.json`;
fs.writeFileSync(bk,JSON.stringify(plan.map(p=>({id:p.r.id,tx_date:p.r.tx_date,amount:p.r.amount,currency:p.r.currency,amount_idr_lama:p.r.amount_idr,description:p.r.description})),null,1));
console.log('backup:',bk);
let ok=0;
for(const p of plan){const{error}=await supabase.from('ledger').update({amount_idr:Math.round(p.idr),fx_rate_used:p.rate}).eq('id',p.r.id).eq('user_id',uid);
  if(error)console.log('GAGAL',p.r.id,error.message);else ok++;}
console.log(`ditulis ${ok}/${plan.length}`);
process.exit(0);})();
