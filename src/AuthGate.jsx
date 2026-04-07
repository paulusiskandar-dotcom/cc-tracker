// AuthGate.jsx
// ─── Wrap App dengan login screen
// Ganti import di index.js: import AuthGate from './AuthGate'; → <AuthGate/>

import { useState, useEffect } from 'react';
import { auth } from './lib/supabase';

export default function AuthGate({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode]       = useState('login');   // 'login' | 'signup'
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [busy, setBusy]       = useState(false);

  useEffect(() => {
    auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
    const { data: { subscription } } = auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async () => {
    setError(''); setBusy(true);
    try {
      if (mode === 'login') {
        const { error: e } = await auth.signIn(email, password);
        if (e) throw e;
      } else {
        const { error: e } = await auth.signUp(email, password);
        if (e) throw e;
        setError('✅ Akun dibuat! Cek email untuk konfirmasi, lalu login.');
        setMode('login'); setBusy(false); return;
      }
    } catch (e) {
      setError(e.message || 'Terjadi kesalahan');
    }
    setBusy(false);
  };

  if (loading) return (
    <div style={S.center}>
      <div style={S.spinner}/>
    </div>
  );

  if (!user) return (
    <div style={S.root}>
      <style>{CSS}</style>
      <div style={S.card}>
        <div style={S.logo}>💳</div>
        <div style={S.title}>CC Tracker</div>
        <div style={S.sub}>Hamasa · SDC · Pribadi</div>

        <div style={S.tabs}>
          <button className={`auth-tab ${mode==='login'?'active':''}`} onClick={()=>setMode('login')}>Masuk</button>
          <button className={`auth-tab ${mode==='signup'?'active':''}`} onClick={()=>setMode('signup')}>Daftar</button>
        </div>

        <input style={S.inp} type="email" placeholder="Email" value={email}
          onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSubmit()}/>
        <input style={S.inp} type="password" placeholder="Password" value={password}
          onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSubmit()}/>

        {error && <div style={S.err}>{error}</div>}

        <button style={S.btn} onClick={handleSubmit} disabled={busy}>
          {busy ? '...' : mode==='login' ? 'Masuk' : 'Buat Akun'}
        </button>

        <div style={S.hint}>Data tersimpan aman di Supabase · Akses dari device manapun</div>
      </div>
    </div>
  );

  // Inject user & signOut ke children
  return children({ user, signOut: () => auth.signOut() });
}

const S = {
  root:    { minHeight:'100vh', background:'#050510', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'Plus Jakarta Sans',system-ui,sans-serif" },
  center:  { minHeight:'100vh', background:'#050510', display:'flex', alignItems:'center', justifyContent:'center' },
  spinner: { width:32, height:32, border:'3px solid rgba(255,255,255,0.1)', borderTop:'3px solid #6366f1', borderRadius:'50%', animation:'spin 0.8s linear infinite' },
  card:    { background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:20, padding:'36px 32px', width:'100%', maxWidth:380, textAlign:'center' },
  logo:    { fontSize:48, marginBottom:12 },
  title:   { fontSize:24, fontWeight:800, color:'#f1f5f9', marginBottom:4 },
  sub:     { fontSize:12, color:'#334155', marginBottom:28 },
  tabs:    { display:'flex', background:'rgba(255,255,255,0.04)', borderRadius:10, padding:3, marginBottom:20 },
  inp:     { width:'100%', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'#e2e8f0', padding:'11px 14px', borderRadius:10, fontFamily:'inherit', fontSize:14, outline:'none', marginBottom:10, boxSizing:'border-box' },
  err:     { fontSize:12, color:'#f87171', marginBottom:12, padding:'8px 12px', background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:8, textAlign:'left' },
  btn:     { width:'100%', background:'linear-gradient(135deg,#4f46e5,#7c3aed)', color:'white', border:'none', padding:'12px', borderRadius:10, fontFamily:'inherit', fontWeight:700, fontSize:14, cursor:'pointer', marginTop:4 },
  hint:    { fontSize:11, color:'#1e293b', marginTop:16, lineHeight:1.5 },
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');
@keyframes spin { to { transform: rotate(360deg); } }
.auth-tab { flex:1; border:none; background:transparent; color:#475569; padding:8px; border-radius:8px; font-family:inherit; font-weight:700; font-size:13px; cursor:pointer; transition:all .15s; }
.auth-tab.active { background:rgba(99,102,241,0.15); color:#a5b4fc; }
`;
