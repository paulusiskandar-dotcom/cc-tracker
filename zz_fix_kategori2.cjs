// Rekategorisasi berdasarkan sifat barang (jawaban Paulus 2026-08-27).
// DRY-RUN default; --apply utk menulis.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const C=n=>{const c=(cats||[]).find(x=>x.name===n);if(!c)throw new Error('kategori tak ada: '+n);return c;};
const PLAN=[
  {re:/DON\s?QUIJOTE|DONQUIJOTE/i,      to:'Donations & Gifts',      why:'oleh-oleh (Paulus)'},
  {re:/HOTSUKAIDOUMIYAGE/i,             to:'Donations & Gifts',      why:'miyage = oleh-oleh Hokkaido'},
  {re:/NAMBA CITY/i,                    to:'Clothing & Accessories', why:'baju (Paulus)'},
  {re:/GRAND FRONT OSAKA/i,             to:'Clothing & Accessories', why:'baju (Paulus) — termasuk baris refundnya'},
  {re:/SURUGAYA/i,                      to:'Hobbies & Entertainment',why:'toko game/anime'},
];
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const jobs=[];
for(const p of PLAN){
  // termasuk baris income (refund) supaya pengurangnya ikut kategori barunya
  const hit=led.filter(r=>p.re.test(r.description||'')&&['expense','pay_liability','income'].includes(r.tx_type)&&r.category_name!==p.to);
  console.log(`\n${p.to}  ←  ${p.why}   (${hit.length} baris)`);
  for(const r of hit)console.log(`   ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type==='income'?'REFUND':'      '} ${(r.category_name||'-').padEnd(22)} | ${(r.description||'').slice(0,44)}`);
  hit.forEach(r=>jobs.push({r,cat:C(p.to)}));
}
const g={};jobs.forEach(j=>{const s=j.r.category_name||'-';g[s]=(g[s]||0)+(j.r.tx_type==='income'?-1:1)*Number(j.r.amount_idr);});
console.log('\ndampak bersih per kategori asal:');for(const[k,v]of Object.entries(g))console.log(`  ${k.padEnd(22)} −${rp(v)}`);
const g2={};jobs.forEach(j=>{g2[j.cat.name]=(g2[j.cat.name]||0)+(j.r.tx_type==='income'?-1:1)*Number(j.r.amount_idr);});
console.log('bertambah ke:');for(const[k,v]of Object.entries(g2))console.log(`  ${k.padEnd(22)} +${rp(v)}`);
if(!APPLY){console.log(`\n[DRY-RUN] ${jobs.length} baris. tambahkan --apply.`);process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
const bk=`.backups/kategori2_${Date.now()}.json`;
fs.writeFileSync(bk,JSON.stringify(jobs.map(j=>({id:j.r.id,tx_date:j.r.tx_date,amount_idr:j.r.amount_idr,dari:j.r.category_name,ke:j.cat.name,description:j.r.description})),null,1));
console.log('backup:',bk);
let ok=0;
for(const j of jobs){const{error}=await supabase.from('ledger').update({category_id:j.cat.id,category_name:j.cat.name}).eq('id',j.r.id).eq('user_id',uid);
  if(error)console.log('GAGAL',j.r.id,error.message);else ok++;}
console.log(`ditulis ${ok}/${jobs.length}`);
process.exit(0);})();
