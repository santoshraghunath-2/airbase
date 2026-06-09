import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { data: userRecord } = await supabaseService
      .from("users")
      .select("tenant_id, id, role")
      .eq("auth_id", user.id)
      .single();
    if (!userRecord) throw new Error("User not found");

    const tenantId = userRecord.tenant_id as string;
    const body = await req.json() as { job_id: string; tech_id: string };

    // Verify job belongs to tenant
    const { data: job, error: jobError } = await supabaseService
      .from("jobs")
      .select("*, customers(name, phone), service_locations(address, city, state)")
      .eq("id", body.job_id)
      .eq("tenant_id", tenantId)
      .single();
    if (jobError || !job) throw new Error("Job not found");

    // Verify tech belongs to tenant
    const { data: tech, error: techError } = await supabaseService
      .from("technicians")
      .select("id, name, phone")
      .eq("id", body.tech_id)
      .eq("tenant_id", tenantId)
      .single();
    if (techError || !tech) throw new Error("Technician not found");

    // Update job
    const { data: updatedJob, error: updateError } = await supabaseService
      .from("jobs")
      .update({
        tech_id: body.tech_id,
        status: "dispatched",
        dispatched_by: userRecord.id,
      })
      .eq("id", body.job_id)
      .select("*")
      .single();
    if (updateError) throw updateError;

    // Send tech notification SMS
    const { data: tenant } = await supabaseService
      .from("tenants")
      .select("twilio_phone_number, name")
      .eq("id", tenantId)
      .single();

    if (tenant?.twilio_phone_number && tech.phone) {
      void fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            to: tech.phone,
            tenantId,
            template: "tech_dispatch",
            variables: {
              techName: tech.name,
              customerName: (job.customers as { name: string }).name,
              address: `${(job.service_locations as { address: string; city: string }).address}, ${(job.service_locations as { city: string }).city}`,
              scheduledStart: job.scheduled_start,
              jobType: job.job_type,
            },
          }),
        }
      );
    }

    return new Response(JSON.stringify({ job: updatedJob }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("dispatch-job error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
