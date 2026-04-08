import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const url    = new URL(req.url)
  const code   = url.searchParams.get("code")
  const state  = url.searchParams.get("state")   // user_id passed via OAuth state param
  const oauthError = url.searchParams.get("error")

  const APP_URL    = Deno.env.get("APP_URL")               ?? "https://localhost:3000"
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")        ?? ""
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  const redirectUri  = `${SUPABASE_URL}/functions/v1/gmail-oauth`

  // Google denied access or user cancelled
  if (oauthError) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${APP_URL}?gmail=error&reason=${encodeURIComponent(oauthError)}` },
    })
  }

  if (!code) {
    return new Response("Missing code", { status: 400 })
  }

  try {
    // Exchange authorization code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     Deno.env.get("GOOGLE_CLIENT_ID")     ?? "",
        client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
        redirect_uri:  redirectUri,
        grant_type:    "authorization_code",
      }),
    })

    const tokens = await tokenRes.json()

    if (!tokens.access_token) {
      throw new Error(tokens.error_description || "No access token received")
    }

    // Get Gmail profile (email address)
    const profileRes = await fetch(
      "https://www.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    )
    const profile = profileRes.ok ? await profileRes.json() : {}

    // Save tokens to Supabase using service role key (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

    const { error: dbError } = await supabase.from("gmail_tokens").upsert({
      user_id:       state,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token ?? "",
      token_expiry:  new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
      gmail_email:   profile.emailAddress ?? "",
      connected_at:  new Date().toISOString(),
    }, { onConflict: "user_id" })

    if (dbError) throw new Error("Database error: " + dbError.message)

    // Redirect back to app — popup will detect the URL change
    return new Response(null, {
      status: 302,
      headers: { Location: `${APP_URL}?gmail=connected` },
    })
  } catch (error) {
    console.error("[gmail-oauth] error:", error)
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${APP_URL}?gmail=error&message=${encodeURIComponent(error.message)}`,
      },
    })
  }
})
