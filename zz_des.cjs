const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let st=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger_staging').select('account_id,tx_date,amount,direction,description,status,source_file').eq('user_id',uid).lt('tx_date','2026-01-01').order('tx_date').range(off,off+999);st=st.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== data DESEMBER 2025 yg masih tersimpan di staging ===');
console.log('total baris:',st.length);
const g={};st.forEach(r=>{const k=nm(r.account_id);g[k]=g[k]||{n:0,out:0,inn:0};g[k].n++;if(r.direction==='out')g[k].out+= +r.amount;else g[k].inn+= +r.amount;});
for(const[k,v]of Object.entries(g).sort((a,b)=>b[1].out-a[1].out))
  console.log(`  ${k.padEnd(16)} ${String(v.n).padStart(4)} baris · keluar ${rp(v.out).padStart(13)} · masuk ${rp(v.inn).padStart(13)}`);
console.log('\n=== kandidat piutang Desember (pola yg sama dgn Jan–Agu) ===');
const POLA=[['Lazada (PLN & tagihan)',/LAZADA/i],['Tokopedia',/TOKOPEDIA/i],['DigitalOcean',/DIGITALOCEAN/i],['Global Digital Niaga/Xendit',/GLOBAL DIGITAL|XENDI/i]];
let tot=0;
for(const[lab,re]of POLA){
  const h=st.filter(r=>re.test(r.description||'')&&r.direction==='out');
  const s=h.reduce((a,r)=>a+ +r.amount,0);tot+=s;
  console.log(`  ${lab.padEnd(28)} ${String(h.length).padStart(3)} baris = ${rp(s).padStart(13)}`);
}
console.log(`  ${'TOTAL kandidat'.padEnd(28)}     ${rp(tot).padStart(13)}`);
console.log('\n  (bandingkan: ketimpangan piutang Hamasa Jan–Mar ≈ 373 juta)');
console.log('\n=== file statement Desember yang tersedia di .backups ===');
try{const dirs=fs.readdirSync('.backups').filter(d=>/des|dec|jan/i.test(d));
for(const d of dirs){try{const f=fs.readdirSync('.backups/'+d);console.log(`  ${d}/ → ${f.length} file: ${f.slice(0,6).join(', ')}${f.length>6?' …':''}`);}catch(e){}}}catch(e){console.log('  (tidak terbaca)');}
process.exit(0);})();
