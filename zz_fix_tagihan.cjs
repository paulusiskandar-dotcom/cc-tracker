const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const C=n=>(cats||[]).find(x=>x.name===n);
// Hanya yg TERBUKTI dari isi email, bukan tebakan:
//  10-01 1.254.167 = bukti penerimaan negara DJP, NPWP pribadi Paulus  → Taxes
//  19-01 1.698.808 = PAM Jaya + 2 Telkomsel Halo + Indosat HiFi        → Housing & Utilities
const PLAN=[
  {date:'2026-01-10',amt:1254167,to:'Taxes',              note:'pembayaran pajak DJP via Tokopedia (NPWP pribadi)'},
  {date:'2026-01-19',amt:1698808,to:'Housing & Utilities',note:'PAM Jaya + Telkomsel Halo 2 nomor + Indosat HiFi'},
];
const done=[];
for(const p of PLAN){
  const{data:rows}=await supabase.from('ledger').select('id,tx_date,amount_idr,category_name,description').eq('user_id',uid).eq('tx_date',p.date).eq('tx_type','expense');
  const hit=(rows||[]).filter(r=>Math.abs(+r.amount_idr-p.amt)<1&&/tokopedia/i.test(r.description||''));
  if(hit.length!==1){console.log(`LEWAT ${p.date} ${rp(p.amt)} — cocok ${hit.length} baris`);continue;}
  done.push({r:hit[0],p});
}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/tagihan_${Date.now()}.json`,JSON.stringify(done.map(d=>({id:d.r.id,dari:d.r.category_name,ke:d.p.to,amt:d.r.amount_idr})),null,1));
for(const d of done){
  const c=C(d.p.to);
  const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name,notes:d.p.note}).eq('id',d.r.id).eq('user_id',uid);
  console.log(error?('GAGAL '+error.message):`ok ${d.r.tx_date} ${rp(d.r.amount_idr).padStart(11)} : ${d.r.category_name} → ${d.p.to}`);
}
process.exit(0);})();
