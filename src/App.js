import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user || null);
    });
    return () => sub?.subscription?.unsubscribe();
  }, []);

  if (loading) return (
    <div style={{ padding: 40, fontFamily: "Figtree, sans-serif", color: "#6b7280" }}>
      Loading…
    </div>
  );

  if (!user) return (
    <div style={{ padding: 40, fontFamily: "Figtree, sans-serif", maxWidth: 400, margin: "100px auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: "#111827" }}>
        Paulus Finance v3
      </h1>
      <p style={{ color: "#9ca3af", marginBottom: 32, fontSize: 13 }}>v3.0.0 — Day 1 foundation</p>
      <button
        onClick={async () => {
          const email    = prompt("Email?");
          const password = prompt("Password?");
          if (email && password) {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) alert(error.message);
          }
        }}
        style={{
          padding: "10px 20px", borderRadius: 6,
          background: "#3b5bdb", color: "#fff",
          border: "none", cursor: "pointer",
          fontFamily: "Figtree, sans-serif", fontSize: 14, fontWeight: 600,
        }}
      >
        Sign In
      </button>
    </div>
  );

  return (
    <div style={{ padding: 40, fontFamily: "Figtree, sans-serif" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: "#111827" }}>
        Paulus Finance v3
      </h1>
      <p style={{ color: "#6b7280", fontSize: 14 }}>Hello, {user.email}</p>
      <p style={{ color: "#9ca3af", marginTop: 24, fontSize: 12 }}>
        v3.0.0 — Day 1 foundation · Schema loaded · Auth working
      </p>
      <button
        onClick={() => supabase.auth.signOut()}
        style={{
          marginTop: 24, padding: "8px 16px", borderRadius: 6,
          border: "1px solid #e5e7eb", background: "#fff",
          cursor: "pointer", fontFamily: "Figtree, sans-serif",
          fontSize: 13, color: "#374151",
        }}
      >
        Sign Out
      </button>
    </div>
  );
}

export default App;
