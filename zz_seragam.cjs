const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const P=[
 [/MOBILE LEGENDS/i,      'Hobbies & Entertainment'],
 [/NZB\s?360|NZB MEDIA|GOOGLE\*NZB/i,'Subscriptions & Software'],
 [/ASEP AZIZ/i,           'Staff & Services'],
 [/GIAT KURNIA/i,         'Health & Personal Care'],
 [/\bLYNK\b/i,            'Subscriptions & Software'],
];
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const C=n=>(cats||[]).find(x=>x.name===n);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,category_name,description').eq('user_id',uid).in('tx_type',['expense','pay_liability']).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const jobs=[];
for(const r of led){const p=P.find(([re])=>re.test(r.description||''));if(p&&r.category_name!==p[1])jobs.push({r,k:p[1]});}
const g={};jobs.forEach(j=>{g[j.k]=g[j.k]||{n:0,t:0};g[j.k].n++;g[j.k].t+= +j.r.amount_idr;});
for(const[k,v]of Object.entries(g))console.log(`  → ${k.padEnd(26)} ${String(v.n).padStart(3)} baris ${rp(v.t).padStart(11)}`);
console.log(`  total ${jobs.length} baris`);
if(!APPLY){console.log('[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/seragam_${Date.now()}.json`,JSON.stringify(jobs.map(j=>j.r),null,1));
let ok=0;
for(const j of jobs){const c=C(j.k);const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name}).eq('id',j.r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL',error.message);}
console.log(`ditulis ${ok}/${jobs.length}`);
process.exit(0);})();
