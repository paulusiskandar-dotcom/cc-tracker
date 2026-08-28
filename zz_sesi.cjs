const fs=require('fs'),B='/Users/paulusiskandar/cc-tracker/';
const load=f=>Object.fromEntries(fs.readFileSync(B+f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require(B+'app.headless.cjs');
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const acc=await accountsApi.getAll(uid);const nm=id=>acc.find(x=>x.id===id)?.name||'—';
const{data:s,error}=await supabase.from('reconcile_sessions').select('*').eq('user_id',uid).order('created_at',{ascending:false}).limit(6);
if(error){console.log('ERR',error.message);process.exit(1);}
console.log(`kolom: ${Object.keys(s[0]||{}).join(', ')}\n`);
for(const x of s){
  const rows=x.statement_rows||x.rows||x.parsed_rows||null;
  console.log(`${x.id.slice(0,8)} ${nm(x.account_id).padEnd(16)} ${x.status.padEnd(10)} ${String(x.period_start||'').slice(0,10)}..${String(x.period_end||'').slice(0,10)} baris statement: ${Array.isArray(rows)?rows.length:'?'}`);
}
process.exit(0);})();
