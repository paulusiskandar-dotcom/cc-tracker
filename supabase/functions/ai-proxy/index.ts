import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  console.log("ai-proxy called:", req.method, req.url);
  const keyExists = !!Deno.env.get("ANTHROPIC_KEY");
  console.log("ANTHROPIC_KEY exists:", keyExists);

  try {
    const body = await req.json();
    console.log("ai-proxy action:", body?.action, "model:", body?.model);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_KEY") ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      // Anthropic error body: { type: "error", error: { type, message } }
      const errMsg = data?.error?.message || data?.message ||
                     JSON.stringify(data?.error ?? data);
      console.error("Anthropic API error:", response.status, errMsg);
      return new Response(
        JSON.stringify({ error: errMsg }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("ai-proxy success, usage:", data?.usage);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("ai-proxy exception:", error);
    return new Response(JSON.stringify({ error: error.message ?? String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
