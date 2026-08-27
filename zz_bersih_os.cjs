const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
// [pola deskripsi, kategori, catatan]
const P=[
 [/SOCIOLLA/i,          'Donations & Gifts',      'Sociolla — hadiah'],
 [/MOYUKSAPPORO|LOFT/i, 'Home & Furniture',       'LOFT Sapporo'],
 [/TJX Europe/i,        'Clothing & Accessories', 'TJX Europe'],
 [/HAPIHOME/i,          'Home & Furniture',       'Hapihome'],
 [/RELX/i,              'Health & Personal Care', 'RELX'],
 [/AZREN IRWAN/i,       'Clothing & Accessories', 'baju'],
 [/TTS BY TKPD 10401284757/i,'Vehicle',           'karpet BYD'],
 [/TTS BY TKPD$/i,      'Electronics & Gadgets',  'vacuum cleaner'],
 // transfer kecil tak dikenal → Food & Dining (aturan Paulus: kalau kecil, food)
 [/DENNIS FERDIYANTO|PGDP PLUIT|REV STORE|AHMAD MUSTOFA|PUTRI DWIYANI|WIYANTO|6863GUARD|CAHAYA MANDIRI|MITRA ADIJAYA|MOCH YUSUF|GALUH PUTRA/i,'Food & Dining',null],
];
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const C=n=>(cats||[]).find(x=>x.name===n);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,category_name,description').eq('user_id',uid).in('tx_type',['expense','pay_liability']).eq('category_name','Online Shopping').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const jobs=[];
for(const r of led){
  const p=P.find(([re])=>re.test(r.description||''));
  if(p)jobs.push({r,k:p[1],n:p[2]});
}
console.log('=== akan dipindahkan ===');
for(const j of jobs)console.log(`  ${j.r.tx_date} ${rp(j.r.amount_idr).padStart(10)} ${nm(j.r.from_id).padEnd(14)} → ${j.k.padEnd(24)}${j.n?' · '+j.n:''} | ${(j.r.description||'').slice(0,30)}`);
console.log(`\n${jobs.length} dari ${led.length} baris sisa`);
const sisa=led.filter(r=>!jobs.some(j=>j.r.id===r.id));
if(sisa.length){console.log('\nmasih tersisa:');for(const r of sisa)console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(10)} | ${(r.description||'').slice(0,44)}`);}
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/bersihos_${Date.now()}.json`,JSON.stringify(jobs.map(j=>j.r),null,1));
let ok=0;
for(const j of jobs){const c=C(j.k);const upd={category_id:c.id,category_name:c.name};if(j.n)upd.notes=j.n;
  const{error}=await supabase.from('ledger').update(upd).eq('id',j.r.id).eq('user_id',uid);if(!error)ok++;else console.log('GAGAL',error.message);}
console.log(`ditulis ${ok}/${jobs.length}`);
process.exit(0);})();
