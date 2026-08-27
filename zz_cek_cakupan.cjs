const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const NOISE=/^(backfill|statement |imported from|migrated|auto|ipl\/internet)/i;
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,category_name,description,notes').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const guna=r=>{const n=(r.notes||'').trim();return n&&!NOISE.test(n);};
for(const[lab,re]of [['Tokopedia',/tokopedia/i],['Shopee',/shopee/i],['Lazada',/lazada/i],['Amazon',/amazon/i]]){
  const h=led.filter(r=>re.test(r.description||''));
  const ada=h.filter(guna);
  console.log(`${lab.padEnd(10)} ${String(h.length).padStart(3)} baris · ada deskripsi ${String(ada.length).padStart(3)} (${Math.round(ada.length/h.length*100)}%) · kosong ${h.length-ada.length}`);
}
console.log('\nbaris Tokopedia TANPA deskripsi, per bulan:');
const tk=led.filter(r=>/tokopedia/i.test(r.description||'')&&!guna(r));
const m={};tk.forEach(r=>{const k=r.tx_date.slice(0,7);m[k]=m[k]||{n:0,t:0};m[k].n++;m[k].t+= +r.amount_idr;});
for(const[k,v]of Object.entries(m).sort())console.log(`  ${k}: ${String(v.n).padStart(3)} baris ${rp(v.t).padStart(12)}`);
console.log(`  TOTAL ${tk.length} baris ${rp(tk.reduce((s,r)=>s+ +r.amount_idr,0))}`);
process.exit(0);})();
