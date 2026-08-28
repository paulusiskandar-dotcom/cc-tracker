const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const oc=accounts.find(a=>a.name==='OCBC 90N');
await recalculateBalance(oc.id,uid);
const{data:a}=await supabase.from('accounts').select('*').eq('id',oc.id).single();
console.log('OCBC 90N: type',a.type,'| initial',rp(a.initial_balance),'| current',rp(a.current_balance));
let keluar=0,masuk=0,n=0;
for(const col of['from_id','to_id']){
  let all=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,'+col).eq('user_id',uid).eq(col,oc.id).range(off,off+999);all=all.concat(c||[]);if(!c||c.length<1000)break;}
  for(const r of all){n++;col==='from_id'?keluar+= +r.amount_idr:masuk+= +r.amount_idr;}
}
console.log(`baris menyentuh kartu: ${n} | belanja (from) ${rp(keluar)} | pembayaran+kredit (to) ${rp(masuk)}`);
console.log(`initial ${rp(a.initial_balance)} + belanja ${rp(keluar)} − bayar ${rp(masuk)} = ${rp(+a.initial_balance+keluar-masuk)}`);
console.log('\nseharusnya: tagihan 12 Agu 2026 dari statement terakhir');
const{data:l}=await supabase.from('ledger').select('tx_date,amount_idr,tx_type').eq('user_id',uid).eq('from_id',oc.id).order('tx_date',{ascending:false}).limit(3);
for(const r of l||[])console.log(`  terakhir: ${r.tx_date} ${rp(r.amount_idr)} ${r.tx_type}`);
process.exit(0);})();
