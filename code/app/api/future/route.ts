import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!; // service role key
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const ELEVEN_AGENT_PHONE_NUMBER_ID = process.env.ELEVEN_AGENT_PHONE_NUMBER_ID!;
const MAX_CONCURRENT_CALLS = Number(process.env.MAX_CONCURRENT_CALLS || "20");

function requireEnv() {
  for (const [k, v] of Object.entries({
    SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    ELEVENLABS_API_KEY,
    ELEVEN_AGENT_PHONE_NUMBER_ID,
  })) {
    if (!v) throw new Error(`Missing env var: ${k}`);
  }
}

async function supabaseRest(path: string, options: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

async function markScheduled(id: string, patch: Record<string, any>) {
  await supabaseRest(`/scheduled_calls?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

async function patchCall(id: string, patch: Record<string, any>) {
  await supabaseRest(`/calls?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

async function countActiveCalls(): Promise<number> {
  const res = await supabaseRest(
    `/calls?status=in.(queued,dialing,in_progress)&select=id&limit=200`
  );
  if (!res.ok) return 0;
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * Best: use RPC if you created it:
 *   POST /rest/v1/rpc/claim_due_scheduled_calls { p_limit }
 * Fallback: select due + patch status=executing with a status guard.
 */
async function claimDueScheduled(limit: number) {
  const nowIso = new Date().toISOString();

  // Try RPC first
  const rpcRes = await supabaseRest(`/rpc/claim_due_scheduled_calls`, {
    method: "POST",
    body: JSON.stringify({ p_limit: limit }),
  });

  if (rpcRes.ok) {
    const jobs = await rpcRes.json();
    if (Array.isArray(jobs)) return jobs;
  } else {
    const t = await rpcRes.text().catch(() => "");
    console.log("[cron] claim rpc failed, using fallback:", t);
  }

  // Fallback: find due rows
  const dueRes = await supabaseRest(
    `/scheduled_calls?status=eq.pending` +
      `&scheduled_for=lte.${encodeURIComponent(nowIso)}` +
      `&select=id,clerk_user_id,timestamp_id,scheduled_for,attempt_count` +
      `&order=scheduled_for.asc&limit=${limit}`
  );
  if (!dueRes.ok) {
    const t = await dueRes.text().catch(() => "");
    throw new Error(`Failed to fetch due scheduled calls: ${t}`);
  }

  const due = await dueRes.json();
  if (!Array.isArray(due) || due.length === 0) return [];

  const claimed: any[] = [];

  for (const row of due) {
    const claimRes = await supabaseRest(
      `/scheduled_calls?id=eq.${row.id}&status=eq.pending`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          status: "executing",
          last_attempt_at: nowIso,
          attempt_count: (row.attempt_count ?? 0) + 1,
        }),
      }
    );

    if (!claimRes.ok) continue;
    const updated = await claimRes.json();
    if (Array.isArray(updated) && updated.length) claimed.push(updated[0]);
  }

  return claimed;
}

type Body = { limit?: number };

export async function POST(req: Request) {
  requireEnv();

  const traceId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const requestedLimit = Math.max(1, Math.min(Number(body?.limit || 5), 25));

  console.log("[cron]", traceId, "invoked", { nowIso, requestedLimit });

  // Concurrency guard (prevents blowing past your plan limits)
  const active = await countActiveCalls();
  const available = Math.max(0, MAX_CONCURRENT_CALLS - active);
  const limit = Math.min(requestedLimit, available);

  console.log("[cron]", traceId, "capacity", { active, available, limit });

  if (limit <= 0) {
    return NextResponse.json({ ok: true, processed: 0, note: "busy", traceId });
  }

  // Claim due jobs
  let jobs: any[] = [];
  try {
    jobs = await claimDueScheduled(limit);
  } catch (e: any) {
    console.log("[cron]", traceId, "claim_failed", e?.message || e);
    return NextResponse.json(
      { ok: false, error: e?.message || "claim_failed", traceId },
      { status: 500 }
    );
  }

  console.log("[cron]", traceId, "claimed", {
    count: jobs.length,
    ids: jobs.map((j) => j.id),
  });

  let processed = 0;

  for (const job of jobs) {
    const scheduledCallId = job.id as string;
    const clerkUserId = job.clerk_user_id as string;
    const timestampId = job.timestamp_id as string;

    let callId: string | null = null;

    try {
      // Load profile
      const profRes = await supabaseRest(
        `/profiles?clerk_user_id=eq.${clerkUserId}&select=setup_status,eleven_agent_id,phone_e164`
      );
      const profRows = profRes.ok ? await profRes.json() : [];
      const prof = Array.isArray(profRows) ? profRows[0] : null;

      if (!prof) throw new Error("profile_not_found");
      if (prof.setup_status !== "ready") throw new Error("profile_not_ready");
      if (!prof.eleven_agent_id) throw new Error("missing_agent_id");
      if (!prof.phone_e164) throw new Error("missing_phone");

      // Create call row
      const callInsert = await supabaseRest(`/calls?select=id`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          clerk_user_id: clerkUserId,
          timestamp_id: timestampId,
          scheduled_call_id: scheduledCallId,
          origin: "scheduled",
          call_mode: "phone",
          status: "queued",
          to_number_e164: prof.phone_e164,
          agent_phone_number_id: ELEVEN_AGENT_PHONE_NUMBER_ID,
        }),
      });

      if (!callInsert.ok) {
        const t = await callInsert.text().catch(() => "");
        throw new Error("call_row_insert_failed: " + t);
      }

      const callRows = await callInsert.json();
      callId = callRows?.[0]?.id || null;
      if (!callId) throw new Error("no_call_id_returned");

      // Dial via ElevenLabs
      const elRes = await fetch(
        "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
        {
          method: "POST",
          headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            agent_id: prof.eleven_agent_id,
            agent_phone_number_id: ELEVEN_AGENT_PHONE_NUMBER_ID,
            to_number: prof.phone_e164,

            conversation_initiation_client_data: {
              type: "conversation_initiation_client_data",
              dynamic_variables: {
                time_mode: "past",
                first_message:
                  "Hey—it's you from the past. Did we do what we wanted to do?",
              },
            },
          }),
        }
      );

      const elText = await elRes.text().catch(() => "");
      console.log("[cron]", traceId, "eleven_response", {
        scheduledCallId,
        status: elRes.status,
        body: elText.slice(0, 500),
      });

      if (!elRes.ok)
        throw new Error(`eleven_failed_${elRes.status}: ${elText}`);

      let elJson: any = {};
      try {
        elJson = JSON.parse(elText);
      } catch {}

      await patchCall(callId, {
        status: "dialing",
        started_at: nowIso,
        eleven_conversation_id: elJson.conversation_id ?? null,
        twilio_call_sid: elJson.callSid ?? null,
      });

      await markScheduled(scheduledCallId, {
        status: "executed",
        executed_at: nowIso,
        failure_reason: null,
      });

      processed++;
    } catch (e: any) {
      const reason = (e?.message || "unknown_error").slice(0, 900);
      console.log("[cron]", traceId, "job_failed", { scheduledCallId, reason });

      // Mark schedule failed
      await markScheduled(scheduledCallId, {
        status: "failed",
        failure_reason: `[${traceId}] ${reason}`,
      });

      // If call row exists, fail it too
      if (callId) {
        await patchCall(callId, {
          status: "failed",
          ended_at: new Date().toISOString(),
          failure_reason: reason,
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    processed,
    claimed: jobs.length,
    traceId,
  });
}
