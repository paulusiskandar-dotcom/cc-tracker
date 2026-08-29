require('dotenv').config({path:'.env.local'});require('dotenv').config({path:'.secrets.local'});
const {createClient}=require('@supabase/supabase-js');
(async()=>{
const sb=createClient(process.env.REACT_APP_SUPABASE_URL,process.env.REACT_APP_SUPABASE_ANON_KEY);
await sb.auth.signInWithPassword({email:process.env.APP_EMAIL,password:process.env.APP_PASSWORD});
const {data}=await sb.from('accounts').select('*').limit(1);
console.log('kolom accounts:',Object.keys(data[0]).join(', '));
const {data:a}=await sb.from('accounts').select('*').order('name');
console.log('\n=== bank ===');
a.filter(x=>x.type==='bank').forEach(x=>console.log(' ',x.name.padEnd(22),'|',x.account_number||x.last4||'-','| saldo',Number(x.current_balance||0).toLocaleString('id-ID'),'| aktif',x.is_active));
})();
