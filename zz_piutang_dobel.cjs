const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:acc}=await supabase.from('accounts').select('id,name,type,currency,current_balance,is_archived,created_at').eq('user_id',uid).ilike('name','%iutang%').order('name').order('created_at');
console.log('=== akun bernama Piutang ===');
for(const a of acc||[]){
  let n=0;for(const col of['from_id','to_id']){const{count}=await supabase.from('ledger').select('id',{count:'exact',head:true}).eq('user_id',uid).eq(col,a.id);n+=count||0;}
  console.log(`  ${a.id.slice(0,8)} ${a.name.padEnd(17)} ${(a.type||'-').padEnd(12)} saldo ${rp(a.current_balance).padStart(12)} arsip=${a.is_archived?'ya':'tidak'} dibuat ${a.created_at.slice(0,10)} — dipakai ${n} baris`);
}
console.log('\n=== piutang berjalan dihitung dari ledger (baris tanpa cap pelunasan) ===');
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_type,amount_idr,entity,reimburse_settlement_id').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const ent={};
for(const r of led.filter(r=>!r.reimburse_settlement_id)){const e=r.entity||'(kosong)';ent[e]=ent[e]||{out:0,in:0};ent[e][r.tx_type==='reimburse_out'?'out':'in']+= +r.amount_idr;}
for(const[e,v]of Object.entries(ent))console.log(`  ${e.padEnd(10)} keluar ${rp(v.out).padStart(13)}  masuk ${rp(v.in).padStart(13)}  piutang ${rp(v.out-v.in).padStart(12)}`);
process.exit(0);})();
