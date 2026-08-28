#!/usr/bin/env node
// Recalc malam semua kartu kredit — item 5 otomasi (disetujui 2026-08-28).
// Sebab: baris yang ditulis edge function / skrip tidak menyentuh
// accounts.outstanding_amount; tanpa ini saldo bisa basi (kasus HSBC: annual
// fee terbayar tapi outstanding masih 999.695). Aman diulang kapan pun —
// recalculateBalance deterministik dari ledger, bukan delta.
const fs=require('fs'),B=__dirname+'/';
const load=f=>Object.fromEntries(fs.readFileSync(B+f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require(B+'app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:a,error:eA}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});
if(eA){console.error('[recalc] login gagal:',eA.message);process.exit(1);}
const uid=a.user.id;
const acc=await accountsApi.getAll(uid);
const kartu=acc.filter(x=>x.type==='credit_card'&&x.is_active!==false);
let berubah=0;
for(const k of kartu){
  const lama=Number(k.outstanding_amount||0);
  try{
    await recalculateBalance(k.id,uid);
  }catch(e){console.error(`[recalc] ${k.name}:`,e?.message);continue;}
}
const acc2=await accountsApi.getAll(uid);
for(const k of kartu){
  const lama=Number(k.outstanding_amount||0);
  const baru=Number(acc2.find(x=>x.id===k.id)?.outstanding_amount||0);
  if(Math.abs(baru-lama)>1){berubah++;console.log(`[recalc] ${k.name}: ${rp(lama)} → ${rp(baru)}`);}
}
console.log(`[recalc] ${new Date().toISOString()} · ${kartu.length} kartu · ${berubah} berubah`);
process.exit(0);})();
