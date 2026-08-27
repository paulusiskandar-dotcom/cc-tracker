const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const AMT=[131588,268349,1254167,151380,1698808,9693415,2678847,467931,483393,7731514,357878,2706631,723533,273654,260808,529625,957615,735083];
const{data:led}=await supabase.from('ledger').select('id,tx_date,amount_idr,from_id,description,installment_id,notes,category_name').eq('user_id',uid).eq('tx_type','expense').gte('tx_date','2026-01-01').lte('tx_date','2026-01-31').ilike('description','%tokopedia%').order('tx_date');
console.log('DESKRIPSI LENGKAP 18 baris tanpa email:\n');
for(const r of (led||[]).filter(r=>AMT.some(a=>Math.abs(a-+r.amount_idr)<1)))
  console.log(` ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${nm(r.from_id).padEnd(13)} cicilan=${r.installment_id?'YA':'-'} | ${r.description}`);
// adakah pola cicilan x/12 di seluruh ledger Tokopedia?
let all=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,amount_idr,description,installment_id').eq('user_id',uid).eq('tx_type','expense').ilike('description','%tokopedia%').order('tx_date').range(off,off+999);all=all.concat(c||[]);if(!c||c.length<1000)break;}
const cic=all.filter(r=>/\d+\/\d+|CCL|CICILAN/i.test(r.description||''));
console.log(`\nbaris Tokopedia berpola cicilan (x/12, CCL, CICILAN): ${cic.length} dari ${all.length} = ${rp(cic.reduce((s,r)=>s+ +r.amount_idr,0))}`);
const link=all.filter(r=>r.installment_id);
console.log(`baris Tokopedia yg punya installment_id: ${link.length}`);
process.exit(0);})();
