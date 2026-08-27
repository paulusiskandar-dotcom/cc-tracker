const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,amount_idr,description').eq('user_id',uid).eq('tx_type','expense').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
// kurs yang TERTULIS di statement kartu miliknya sendiri
const pats=[/JPY\s*([\d.,]+)\s*@\s*([\d.,]+)/i,/1\s*EUR\s*=\s*([\d.,]+)/i,/EUR\s*1\s*=\s*IDR\s*([\d.,]+)/i,/1\s*SGD\s*=\s*(?:IDR\s*)?([\d.,]+)/i,/SGD\s*1\s*=\s*IDR\s*([\d.,]+)/i];
console.log('=== kurs JPY tertulis di statement, Des 2025 – Jan 2026 ===');
for(const r of led.filter(r=>r.tx_date>='2025-12-20'&&r.tx_date<='2026-01-15'&&/@\s*[\d.]+/.test(r.description||'')).slice(0,14))
  console.log(` ${r.tx_date} | ${(r.description||'').slice(0,72)}`);
console.log('\n=== kurs SGD tertulis, Jan 2026 ===');
for(const r of led.filter(r=>r.tx_date>='2026-01-01'&&r.tx_date<='2026-01-15'&&/SGD|Singapore/i.test(r.description||'')).slice(0,10))
  console.log(` ${r.tx_date} | ${(r.description||'').slice(0,72)}`);
console.log('\n=== kurs EUR tertulis, Mar 2026 ===');
const eur=led.filter(r=>r.tx_date>='2026-03-15'&&r.tx_date<='2026-03-31'&&/EUR 1 = IDR|1 EUR = /i.test(r.description||''));
const rates=[];for(const r of eur){const m=(r.description||'').match(/(?:EUR 1 = IDR|1 EUR = )\s*([\d.,]+)/i);if(m)rates.push(parseFloat(m[1].replace(/,/g,'')));}
console.log(' baris ber-kurs:',eur.length,'| rentang kurs:',Math.min(...rates).toFixed(0),'-',Math.max(...rates).toFixed(0));
for(const r of eur.slice(0,4))console.log(`   ${r.tx_date} | ${(r.description||'').slice(0,70)}`);
process.exit(0);})();
