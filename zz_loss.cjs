const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:l}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('category_name','Reimbursable Loss').order('tx_date');
console.log('=== semua baris Reimbursable Loss ===');
let t=0;for(const r of l||[]){t+= +r.amount_idr;
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(9)} ent=${(r.entity||'-').padEnd(8)} ${nm(r.from_id)}[${r.from_type}] → ${nm(r.to_id)}[${r.to_type}] | ${(r.description||'').slice(0,40)}`);}
console.log('  jumlah:',rp(t));
console.log('\n=== apakah 187.000 SDC itu sudah mengurangi piutang? ===');
const{data:x}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('amount_idr',187000).eq('category_name','Reimbursable Loss').single();
console.log('  tx_type:',x.tx_type,'| from:',nm(x.from_id),x.from_type,'| to:',nm(x.to_id),x.to_type);
console.log('  → baris ini',x.tx_type==='expense'?'BUKAN reimburse, jadi TIDAK mengurangi piutang SDC (gap 187.000 masih terhitung dua kali)':'ikut hitungan piutang');
process.exit(0);})();
