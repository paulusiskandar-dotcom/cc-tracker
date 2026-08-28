// ANNUAL FEE WAIVER 1.000.000 CR (transaksi 31/03, dibukukan 12/04) — pembatalan
// annual fee 1 Mar. Belum pernah masuk ledger.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const oc=accounts.find(a=>a.name==='OCBC 90N');
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const ref=(srcs||[]).find(s=>s.name==='Refund');
const{data:ada}=await supabase.from('ledger').select('id').eq('user_id',uid).eq('to_id',oc.id).eq('amount_idr',1000000).ilike('description','%WAIVER%');
if((ada||[]).length){console.log('sudah ada — batal');process.exit(0);}
const{data,error}=await supabase.from('ledger').insert([{user_id:uid,tx_date:'2026-03-31',tx_type:'income',
  amount:1000000,amount_idr:1000000,currency:'IDR',entity:'Personal',
  from_type:'income_source',from_id:ref.id,to_type:'account',to_id:oc.id,
  description:'ANNUAL FEE WAIVER — pembatalan annual fee 1 Mar (dibukukan 12 Apr)',
  source:'statement',notes:'impor statement OCBC 90N (12 Apr 2026)'}]).select('id').single();
if(error)throw new Error(error.message);
console.log('- ANNUAL FEE WAIVER 1.000.000 masuk, sumber',ref.name);
process.exit(0);})();
