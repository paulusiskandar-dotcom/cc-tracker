const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:c}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid).order('name');
console.log('kategori pengeluaran:',(c||[]).map(x=>x.name).join(' | '));
const{data:s}=await supabase.from('income_sources').select('name').eq('user_id',uid);
console.log('\nsumber pendapatan:',(s||[]).map(x=>x.name).join(' | '));
const{data:l}=await supabase.from('ledger').select('tx_date,amount_idr,category_name,description').eq('user_id',uid).ilike('category_name','%loss%').limit(10);
console.log('\nbaris ber-kategori *loss* yang sudah ada:',(l||[]).length);
for(const r of l||[])console.log(`  ${r.tx_date} ${Math.round(r.amount_idr).toLocaleString('id-ID')} ${r.category_name} | ${(r.description||'').slice(0,44)}`);
process.exit(0);})();
