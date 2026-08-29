/**
 * Ganti nama orang di seluruh data transaksi.
 * Dry run: node ganti_nama.cjs   ·   Terapkan: --apply
 */
require('dotenv').config({path:'.env.local'});require('dotenv').config({path:'.secrets.local'});
const {createClient}=require('@supabase/supabase-js');
const KOLOM=['description','merchant_name','notes'];
const CARI=/siti\s*sarnah|syahnaz/ig;
const GANTI='Ebert';
(async()=>{
const apply=process.argv.includes('--apply');
const sb=createClient(process.env.REACT_APP_SUPABASE_URL,process.env.REACT_APP_SUPABASE_ANON_KEY);
await sb.auth.signInWithPassword({email:process.env.APP_EMAIL,password:process.env.APP_PASSWORD});
let all=[],from=0;
for(;;){const r=await sb.from('ledger').select('id,tx_date,amount,amount_idr,tx_type,entity,description,merchant_name,notes').range(from,from+999);
 if(r.error) return console.log('ERR',r.error.message);
 all=all.concat(r.data); if(r.data.length<1000)break; from+=1000;}
console.log('baris ledger diperiksa:',all.length);
const ubah=[];
for(const r of all){
  const patch={};
  for(const k of KOLOM){
    const v=r[k]; if(!v) continue;
    const baru=String(v).replace(CARI,GANTI);
    if(baru!==v) patch[k]=baru;
  }
  if(Object.keys(patch).length) ubah.push({r,patch});
}
ubah.sort((a,b)=>a.r.tx_date<b.r.tx_date?-1:1).forEach(({r,patch})=>{
  console.log(`\n ${r.tx_date}  ${Number(r.amount_idr||r.amount).toLocaleString('id-ID').padStart(12)}  ${r.tx_type} · ${r.entity||'-'}`);
  for(const k of Object.keys(patch)){console.log(`   ${k} lama: ${r[k]}`);console.log(`   ${k} baru: ${patch[k]}`);}
});
console.log(`\n${ubah.length} baris ledger`);

// Tabel lain yang menyimpan nama orang
for(const t of ['employee_loans','reimburse_settlements','recurring_templates','tags','merchants']){
  const {data,error}=await sb.from(t).select('*');
  if(error){console.log(`  (${t}: ${error.message})`);continue;}
  // RegExp global menyimpan lastIndex antar panggilan; pakai salinan segar.
  const re=new RegExp(CARI.source,'i');
  const kena=(data||[]).filter(x=>re.test(JSON.stringify(x)));
  if(kena.length) console.log(`  ${t}: ${kena.length} baris memuat nama itu →`,kena.map(x=>x.name||x.description||x.id.slice(0,8)).join(', '));
}
if(!apply) return console.log('\ndry run — tambahkan --apply');
require('fs').writeFileSync(`.backups/nama-${Date.now()}.json`,JSON.stringify(ubah,null,1));
let n=0;
for(const {r,patch} of ubah){
  const {error}=await sb.from('ledger').update(patch).eq('id',r.id);
  if(error) console.log('GAGAL',r.id,error.message); else n++;
}
console.log(`${n} baris diperbarui`);
})();
