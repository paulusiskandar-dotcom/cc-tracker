import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_MODEL  = "claude-sonnet-4-20250514";
const DEFAULT_TOKENS = 8000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const keyExists = !!Deno.env.get("ANTHROPIC_KEY");
  console.log("ai-proxy called — key exists:", keyExists);

  try {
    const body = await req.json();

    // Build the Anthropic request — always ensure model and max_tokens are set
    const anthropicBody: Record<string, unknown> = {
      model:      body.model      ?? DEFAULT_MODEL,
      max_tokens: body.max_tokens ?? DEFAULT_TOKENS,
      messages:   body.messages,
    };
    // Forward optional fields if present
    if (body.system)      anthropicBody.system      = body.system;
    if (body.temperature) anthropicBody.temperature = body.temperature;

    console.log("ai-proxy → Anthropic model:", anthropicBody.model,
                "messages:", (anthropicBody.messages as unknown[])?.length ?? 0);

    if (!anthropicBody.messages) {
      return new Response(
        JSON.stringify({ error: "messages field is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":    "application/json",
        "x-api-key":       Deno.env.get("ANTHROPIC_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "anthropic-beta":  "pdfs-2024-09-25",  // enable PDF support
      },
      body: JSON.stringify(anthropicBody),
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data?.error?.message || data?.message ||
                     JSON.stringify(data?.error ?? data);
      console.error("Anthropic error:", response.status, errMsg);
      return new Response(
        JSON.stringify({ error: errMsg }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("ai-proxy success — usage:", JSON.stringify(data?.usage));
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("ai-proxy exception:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message ?? String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
