// 1) print deskripsi PENUH 3 transfer yatim BCA R (cari kode bank tujuan)
// 2) APPLY: link pembayaran CC gabungan (Krisflyer+BCA Card[+10rb fee] = 1 baris bank)
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const APPLY=process.argv.includes('apply');

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const acc=n=>accounts.find(a=>a.name===n);

let st=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger_staging').select('id,account_id,tx_date,amount,direction,description,tx_type,counter_account_id,needs_review,split_group_hint').eq('user_id',uid).order('id').range(off,off+999);
  st=st.concat(c||[]);if(!c||c.length<1000)break;}

console.log('1) deskripsi penuh yatim:');
for(const r of st.filter(x=>nm(x.account_id)==='BCA R'&&x.direction==='out'&&['2026-02-19','2026-02-23'].includes(x.tx_date)&&Number(x.amount)>=20000000))
  console.log('  ',r.tx_date,rp(r.amount),'\n    ',JSON.stringify(r.description));

// juga: baris TANPA AKUN 10rb
for(const r of st.filter(x=>Math.round(Number(x.amount))===10000&&/PEMBAYARAN/i.test(x.description||'')))
  console.log('   10rb-row:',r.tx_date,nm(r.account_id),r.direction,JSON.stringify((r.description||'').slice(0,60)));

// 2) link gabungan
const GROUPS=[
 {d:'2025-12-02',bank:'BCA R', bankAmt:14913428,cards:[['BCA Krisflyer',14509496],['BCA Card',393932]]},
 {d:'2026-01-01',bank:'BCA IDR',bankAmt:4479287, cards:[['BCA Krisflyer',4075000],['BCA Card',394287]]},
 {d:'2026-02-02',bank:'BCA IDR',bankAmt:3295943, cards:[['BCA Krisflyer',2775000],['BCA Card',520943]]},
 {d:'2026-02-28',bank:'BCA IDR',bankAmt:5388685, cards:[['BCA Krisflyer',4345863],['BCA Card',1042822]]},
 {d:'2026-03-31',bank:'BCA IDR',bankAmt:31051741,cards:[['BCA Card',1060393],['BCA Krisflyer',29991348]]},
];
const updates=[];
for(const g of GROUPS){
  const bank=st.find(x=>nm(x.account_id)===g.bank&&x.direction==='out'&&Math.round(Number(x.amount))===g.bankAmt&&Math.abs(new Date(x.tx_date)-new Date(g.d))<=6*864e5);
  if(!bank){console.log('2) !! bank row tidak ketemu',g.d,g.bankAmt);continue;}
  const note=' — GABUNGAN: bayar Krisflyer+BCA Card'+(g.bankAmt-g.cards.reduce((s,c)=>s+c[1],0)===10000?'+fee 10rb':'');
  updates.push({id:bank.id,set:{tx_type:'pay_cc',counter_account_id:acc('BCA Krisflyer').id,needs_review:false,
    description:(bank.description||'').slice(0,220)+note}});
  for(const[cn,ca]of g.cards){
    const cr=st.find(x=>nm(x.account_id)===cn&&x.direction==='in'&&x.tx_type==='pay_cc'&&Math.round(Number(x.amount))===ca&&!x.counter_account_id);
    if(cr)updates.push({id:cr.id,set:{counter_account_id:bank.account_id,needs_review:false}});
    else console.log('2) !! card row tidak ketemu',g.d,cn,ca);
  }
  console.log('2) OK',g.d,g.bank,rp(g.bankAmt),'=',g.cards.map(c=>c[0]+' '+rp(c[1])).join(' + '));
}
if(!APPLY){console.log('(dry-run, updates:',updates.length,')');process.exit(0);}
for(const u of updates)await supabase.from('ledger_staging').update(u.set).eq('id',u.id);
console.log('APPLIED',updates.length);
process.exit(0);
})();
