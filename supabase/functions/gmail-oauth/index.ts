// ─────────────────────────────────────────────────────────────────
// gmail-oauth/index.ts
// Handles Google OAuth callback: exchanges code → tokens, saves to DB,
// then redirects back to the app.
// Deploy: supabase functions deploy gmail-oauth
// Secrets needed:
//   GOOGLE_CLIENT_ID  (from Google Cloud Console)
//   GOOGLE_CLIENT_SECRET
//   APP_URL (e.g. https://yourdomain.com or your Netlify/Vercel URL)
// ─────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // user_id
  const error = url.searchParams.get("error");

  const APP_URL           = Deno.env.get("APP_URL") || "https://localhost:3000";
  const GOOGLE_CLIENT_ID  = Deno.env.get("GOOGLE_CLIENT_ID") || "";
  const GOOGLE_SECRET     = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
  const SUPABASE_URL      = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  // OAuth error from Google
  if (error) {
    return Response.redirect(`${APP_URL}?gmail=error&reason=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  const redirectUri = `${SUPABASE_URL}/functions/v1/gmail-oauth`;

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_SECRET,
      redirect_uri:  redirectUri,
      grant_type:    "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error("[gmail-oauth] Token exchange failed:", err);
    return Response.redirect(`${APP_URL}?gmail=error&reason=${encodeURIComponent("Token exchange failed")}`);
  }

  const tokens = await tokenRes.json();
  const { access_token, refresh_token, expires_in } = tokens;

  // Get Gmail email address
  let gmailEmail = "";
  try {
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      gmailEmail = profile.email || "";
    }
  } catch (e) {
    console.warn("[gmail-oauth] Could not fetch Gmail profile:", e);
  }

  const tokenExpiry = new Date(Date.now() + (expires_in || 3600) * 1000).toISOString();

  // Save to Supabase using service role
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { error: dbError } = await supabase.from("gmail_tokens").upsert({
    user_id:       state,
    access_token,
    refresh_token: refresh_token || "",
    token_expiry:  tokenExpiry,
    gmail_email:   gmailEmail,
    connected_at:  new Date().toISOString(),
  }, { onConflict: "user_id" });

  if (dbError) {
    console.error("[gmail-oauth] DB upsert failed:", dbError);
    return Response.redirect(`${APP_URL}?gmail=error&reason=${encodeURIComponent("Database error")}`);
  }

  // Redirect back to app — popup will detect closure
  return Response.redirect(`${APP_URL}?gmail=connected`);
});
