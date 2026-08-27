// Shopee / TikTok — hasil telusur email. Semua PRIBADI (tak satu pun nominalnya ada di sheet).
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const C=n=>(cats||[]).find(x=>x.name===n);
const P=[
 {d:'2026-02-19',a:443311, k:'Hobbies & Entertainment',n:'Bambulab Refill PLA Basic 1KG ×3 (Shopee, penjual 3dzaikuid)'},
 {d:'2026-02-21',a:796000, k:'Health & Personal Care', n:'Gaabor High Speed Hair Dryer HD-M01 (Shopee)'},
 {d:'2026-02-23',a:703500, k:'Home & Furniture',       n:'BOSCH GO Gen 3 cordless screwdriver 3,6V (Shopee)'},
 {d:'2026-06-13',a:3054000,k:'Hobbies & Entertainment',n:'Vinyl 12" Bernadya — Sialnya, Hidup Harus Tetap Berjalan (Shopee)'},
 {d:'2026-06-24',a:686896, k:'Hobbies & Entertainment',n:'Anbernic RG Rotate handheld — cicilan 1/3 (pokok 2.060.688, Shopee)'},
 {d:'2026-07-23',a:686896, k:'Hobbies & Entertainment',n:'Anbernic RG Rotate handheld — cicilan 2/3 (pokok 2.060.688, Shopee)'},
 {d:'2026-07-23',a:3512000,k:'Hobbies & Entertainment',n:'Vinyl Nadin Amizah — Untuk Dunia Cinta, limited (Shopee)'},
];
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,category_name,description').eq('user_id',uid).eq('tx_type','expense').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const jobs=[];
for(const p of P){
  const h=led.filter(r=>r.tx_date===p.d&&Math.abs(+r.amount_idr-p.a)<1&&/shopee/i.test(r.description||''));
  if(h.length!==1){console.log(`  ⚠ ${p.d} ${rp(p.a)} cocok ${h.length}`);continue;}
  console.log(`  ${p.d} ${rp(p.a).padStart(10)} ${nm(h[0].from_id).padEnd(14)} ${h[0].category_name} → ${p.k}`);
  jobs.push({r:h[0],p});
}
console.log(`\n${jobs.length} baris`);
if(!APPLY){console.log('[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/mp_${Date.now()}.json`,JSON.stringify(jobs.map(j=>j.r),null,1));
let ok=0;
for(const j of jobs){const c=C(j.p.k);const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name,notes:j.p.n}).eq('id',j.r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL',error.message);}
console.log(`ditulis ${ok}/${jobs.length}`);
process.exit(0);})();
