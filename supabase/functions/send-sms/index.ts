import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// SMS templates
const TEMPLATES: Record<string, (vars: Record<string, string>) => string> = {
  confirmation: (v) =>
    `Hi ${v.customerName}! Your ${formatJobType(v.jobType)} appointment is confirmed for ${formatDate(v.scheduledStart)}. Reply STOP to opt out.`,
  reminder_24h: (v) =>
    `Reminder: Your ${formatJobType(v.jobType)} appointment is tomorrow at ${formatTime(v.scheduledStart)}. Reply STOP to opt out.`,
  reminder_1h: (v) =>
    `Your technician is on their way within the hour for your ${formatJobType(v.jobType)} appointment. Reply STOP to opt out.`,
  tech_dispatch: (v) =>
    `[${v.companyName ?? "Airbase"}] New job dispatched!\nCustomer: ${v.customerName}\nAddress: ${v.address}\nType: ${formatJobType(v.jobType)}\nTime: ${formatDate(v.scheduledStart)}`,
  tech_on_way: (v) =>
    `Hi ${v.customerName}! Your technician ${v.techName} is on the way and should arrive in about ${v.eta} minutes. Reply STOP to opt out.`,
  job_complete: (v) =>
    `Hi ${v.customerName}! Your service with ${v.companyName} is complete. An invoice will follow shortly. Thank you! Reply STOP to opt out.`,
};

function formatJobType(type: string): string {
  return type?.replace(/_/g, " ") ?? "service";
}

function formatDate(iso: string): string {
  if (!iso) return "your scheduled time";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatTime(iso: string): string {
  if (!iso) return "your scheduled time";
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json() as {
      to: string;
      tenantId: string;
      template: string;
      variables: Record<string, string>;
      body?: string; // optional raw override
    };

    const { data: tenant, error: tenantError } = await supabaseService
      .from("tenants")
      .select("twilio_phone_number, name")
      .eq("id", body.tenantId)
      .single();

    if (tenantError || !tenant?.twilio_phone_number) {
      throw new Error("Tenant Twilio number not configured");
    }

    const messageBody = body.body
      ?? TEMPLATES[body.template]?.({ ...body.variables, companyName: tenant.name })
      ?? body.variables.message;

    if (!messageBody) throw new Error("No message body");

    // Twilio REST API
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const credentials = btoa(`${accountSid}:${authToken}`);

    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: tenant.twilio_phone_number as string,
          To: body.to,
          Body: messageBody,
        }),
      }
    );

    const twilioData = await twilioRes.json() as { sid?: string; error_message?: string };

    if (!twilioRes.ok) {
      throw new Error(`Twilio error: ${twilioData.error_message ?? "Unknown"}`);
    }

    return new Response(JSON.stringify({ sid: twilioData.sid }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("send-sms error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
