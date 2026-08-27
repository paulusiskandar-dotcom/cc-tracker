const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,notes,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const sp=led.filter(r=>/dipecah dari/i.test(r.notes||''));
const g={};
for(const r of sp){const m=(r.notes||'').match(/dipecah dari ([\d.]+)/);if(!m)continue;
  const k=r.tx_date+'|'+m[1];(g[k]=g[k]||[]).push(r);}
console.log('=== cek tiap pecahan: jumlah dua sisi harus = tagihan asli ===');
let salah=0;
for(const[k,v]of Object.entries(g)){
  const asli=Number(k.split('|')[1].replace(/\./g,''));
  const jml=v.reduce((s,r)=>s+ +r.amount_idr,0);
  const ok=Math.abs(jml-asli)<1;if(!ok)salah++;
  console.log(`  ${k.split('|')[0]} tagihan ${rp(asli).padStart(11)} = ${v.map(r=>rp(r.amount_idr)+' ('+(r.tx_type==='expense'?'pribadi':'piutang')+')').join(' + ')} → ${ok?'✓ pas':'⚠ SELISIH '+rp(jml-asli)}`);
}
console.log(salah?`\n⚠ ${salah} pecahan tidak pas`:`\n✓ semua ${Object.keys(g).length} pecahan pas ke rupiah`);
console.log('\n=== 387.390 — muncul di mana saja di ledger? ===');
for(const r of led.filter(r=>Math.abs(+r.amount_idr-387390)<1))
  console.log(`  ${r.tx_date} ${r.tx_type.padEnd(13)} ${nm(r.from_id).padEnd(14)} | ${(r.description||'').slice(0,50)}`);
console.log('\n=== nominal Telkomsel di ledger (cari pola bulanan) ===');
for(const r of led.filter(r=>/TELKOMSEL|HALO/i.test(r.description||'')).slice(0,10))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(10)} ${r.tx_type.padEnd(13)} | ${(r.description||'').slice(0,45)}`);
process.exit(0);})();
