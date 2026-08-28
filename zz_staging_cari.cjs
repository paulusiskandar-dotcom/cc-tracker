const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let st=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger_staging').select('tx_date,amount,direction,description,status,account_id').eq('user_id',uid).neq('status','connected').order('tx_date').range(off,off+999);st=st.concat(c||[]);if(!c||c.length<1000)break;}
console.log('baris staging belum tersambung:',st.length,'| rentang',st[0]?.tx_date,'→',st[st.length-1]?.tx_date);
console.log('\n=== cari nominal SDC yang hilang di staging (toleransi 2.000) ===');
for(const[a,label]of[[3215930,'Alice Dental'],[1950000,'Microsoft 365'],[5147838,'Internet Maret'],[387390,'Internet bulanan']]){
  const h=st.filter(r=>Math.abs(+r.amount-a)<=2000);
  console.log(`\n  ${label} ${rp(a)} — ${h.length} kandidat`);
  for(const r of h)console.log(`     ${r.tx_date} ${rp(r.amount).padStart(11)} ${r.direction} ${nm(r.account_id).padEnd(14)} | ${(r.description||'').slice(0,50)}`);
}
console.log('\n=== staging belum tersambung per akun ===');
const per={};for(const r of st){const k=nm(r.account_id);per[k]=per[k]||{n:0,out:0};per[k].n++;if(r.direction==='out')per[k].out+= +r.amount;}
for(const[k,v]of Object.entries(per).sort((a,b)=>b[1].n-a[1].n))console.log(`  ${k.padEnd(16)} ${String(v.n).padStart(4)} baris  belanja ${rp(v.out).padStart(14)}`);
console.log('\n=== staging belum tersambung per bulan ===');
const bl={};for(const r of st){const m=r.tx_date.slice(0,7);bl[m]=(bl[m]||0)+1;}
for(const[m,n]of Object.entries(bl).sort())console.log(`  ${m}  ${n}`);
process.exit(0);})();
