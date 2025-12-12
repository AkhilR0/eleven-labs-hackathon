import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const ELEVEN_AGENT_PHONE_NUMBER_ID = process.env.ELEVEN_AGENT_PHONE_NUMBER_ID!;

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
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

/**
 * If you have a call stuck in queued/dialing/in_progress, this will try to
 * reconcile it by asking ElevenLabs for conversation details.
 *
 * No webhooks needed — it “self heals” when the user clicks again.
 */
async function reconcileStuckCalls(userId: string) {
  const activeRes = await supabaseRest(
    `/calls?clerk_user_id=eq.${userId}` +
      `&status=in.(queued,dialing,in_progress)` +
      `&select=id,status,created_at,started_at,eleven_conversation_id` +
      `&order=created_at.desc&limit=3`
  );
  if (!activeRes.ok) return;

  const activeCalls = await activeRes.json();
  if (!Array.isArray(activeCalls) || activeCalls.length === 0) return;

  const now = Date.now();
  const STALE_MS = 12 * 60 * 1000; // 12 minutes: anything older gets force-unblocked

  for (const c of activeCalls) {
    const callId = c.id as string;
    const convoId = c.eleven_conversation_id as string | null;

    const startedIso = c.started_at || c.created_at;
    const startedAt = startedIso ? new Date(startedIso).getTime() : null;
    const isStale = startedAt ? now - startedAt > STALE_MS : true;

    // If we never got a conversation_id, we cannot query ElevenLabs. Just clear stale ones.
    if (!convoId) {
      if (isStale) {
        await supabaseRest(`/calls?id=eq.${callId}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: "failed",
            ended_at: new Date().toISOString(),
            failure_reason: "stale_no_conversation_id",
          }),
        });
      }
      continue;
    }

    // Ask ElevenLabs about the conversation
    const elRes = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${convoId}`,
      {
        method: "GET",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          Accept: "application/json",
        },
      }
    );

    // If EL can’t find it and it’s stale, unblock
    if (elRes.status === 404) {
      if (isStale) {
        await supabaseRest(`/calls?id=eq.${callId}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: "failed",
            ended_at: new Date().toISOString(),
            failure_reason: "stale_conversation_not_found",
          }),
        });
      }
      continue;
    }

    // If EL errors and it’s stale, unblock
    if (!elRes.ok) {
      if (isStale) {
        await supabaseRest(`/calls?id=eq.${callId}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: "failed",
            ended_at: new Date().toISOString(),
            failure_reason: `stale_eleven_error_${elRes.status}`,
          }),
        });
      }
      continue;
    }

    const details = await elRes.json();

    // Robustly detect end-of-call using common fields
    const callDuration =
      (typeof details?.call_duration_secs === "number" &&
        details.call_duration_secs) ||
      (typeof details?.callDurationSecs === "number" &&
        details.callDurationSecs) ||
      null;

    const startUnix =
      (typeof details?.start_time_unix_secs === "number" &&
        details.start_time_unix_secs) ||
      (typeof details?.startTimeUnixSecs === "number" &&
        details.startTimeUnixSecs) ||
      null;

    const endUnix =
      (typeof details?.end_time_unix_secs === "number" &&
        details.end_time_unix_secs) ||
      (typeof details?.endTimeUnixSecs === "number" &&
        details.endTimeUnixSecs) ||
      null;

    const statusText = (details?.status || details?.conversation_status || "")
      .toString()
      .toLowerCase();

    const looksEnded =
      (callDuration != null && (startUnix != null || startedAt != null)) ||
      endUnix != null ||
      ["completed", "ended", "done", "finished"].includes(statusText);

    if (looksEnded) {
      // compute ended_at/duration
      let endedAtIso: string | null = null;
      let durationSecs: number | null = null;

      if (endUnix != null) {
        endedAtIso = new Date(endUnix * 1000).toISOString();
      } else if (startUnix != null && callDuration != null) {
        endedAtIso = new Date((startUnix + callDuration) * 1000).toISOString();
      } else if (startedAt != null && callDuration != null) {
        endedAtIso = new Date(startedAt + callDuration * 1000).toISOString();
      } else if (isStale) {
        endedAtIso = new Date().toISOString();
      }

      if (callDuration != null)
        durationSecs = Math.max(0, Math.floor(callDuration));
      else if (startedAt != null && endedAtIso)
        durationSecs = Math.max(
          0,
          Math.floor((new Date(endedAtIso).getTime() - startedAt) / 1000)
        );

      await supabaseRest(`/calls?id=eq.${callId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          ended_at: endedAtIso,
          duration_seconds: durationSecs,
          failure_reason: null,
        }),
      });

      continue;
    }

    // If we still can't determine, force-unblock stale calls
    if (isStale) {
      await supabaseRest(`/calls?id=eq.${callId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "failed",
          ended_at: new Date().toISOString(),
          failure_reason: "stale_unknown_state",
        }),
      });
    }
  }
}

export async function POST() {
  requireEnv();

  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ✅ NEW: fix any stuck calls before checking "active call"
  await reconcileStuckCalls(userId);

  // 1) Load profile
  const profileRes = await supabaseRest(
    `/profiles?clerk_user_id=eq.${userId}&select=*`
  );
  if (!profileRes.ok)
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );

  const profiles = await profileRes.json();
  if (!profiles?.length)
    return NextResponse.json({ error: "Profile not found" }, { status: 400 });

  const profile = profiles[0];
  const agentId: string | undefined = profile.eleven_agent_id;
  const toNumber: string | undefined = profile.phone_e164;

  if (profile.setup_status !== "ready" || !agentId) {
    return NextResponse.json(
      { error: "Not ready. Finish onboarding first." },
      { status: 400 }
    );
  }
  if (!toNumber) {
    return NextResponse.json(
      { error: "Missing phone number on profile." },
      { status: 400 }
    );
  }

  // 2) Ensure user has a timestamp (use latest)
  const tsRes = await supabaseRest(
    `/timestamps?clerk_user_id=eq.${userId}&select=id&order=created_at.desc&limit=1`
  );
  if (!tsRes.ok)
    return NextResponse.json(
      { error: "Failed to fetch timestamp" },
      { status: 500 }
    );
  const tsRows = await tsRes.json();
  if (!tsRows?.length)
    return NextResponse.json({ error: "No timestamp found." }, { status: 400 });
  const timestampId = tsRows[0].id as string;

  // 3) Block if active call exists (after reconciliation)
  const activeRes = await supabaseRest(
    `/calls?clerk_user_id=eq.${userId}&status=in.(queued,dialing,in_progress)&select=id,status&limit=1`
  );
  if (!activeRes.ok)
    return NextResponse.json(
      { error: "Failed to check active calls" },
      { status: 500 }
    );
  const activeCalls = await activeRes.json();
  if (activeCalls?.length) {
    return NextResponse.json(
      {
        error: "You already have a call in progress.",
        activeCall: activeCalls[0],
      },
      { status: 409 }
    );
  }

  // 4) Insert call record (queued)
  const insertRes = await supabaseRest(`/calls?select=id`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      clerk_user_id: userId,
      timestamp_id: timestampId,
      origin: "manual",
      call_mode: "phone",
      status: "queued",
      to_number_e164: toNumber,
      agent_phone_number_id: ELEVEN_AGENT_PHONE_NUMBER_ID,
    }),
  });

  if (!insertRes.ok) {
    const t = await insertRes.text().catch(() => "");
    return NextResponse.json(
      { error: "Failed to create call row", details: t },
      { status: 500 }
    );
  }

  const inserted = await insertRes.json();
  const callRow = inserted?.[0];
  const callId = callRow?.id as string | undefined;
  if (!callId)
    return NextResponse.json(
      { error: "No call id returned from Supabase" },
      { status: 500 }
    );

  // 5) Start outbound call via ElevenLabs
  try {
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
          agent_id: agentId,
          agent_phone_number_id: ELEVEN_AGENT_PHONE_NUMBER_ID,
          to_number: toNumber,
          conversation_initiation_client_data: {
            type: "conversation_initiation_client_data",
            dynamic_variables: {
              time_mode: "future",
              first_message:
                "Hey—it's you from the future. I’m calling to tell you what actually mattered.",
            },
          },
        }),
      }
    );

    if (!elRes.ok) {
      const text = await elRes.text().catch(() => "");
      await supabaseRest(`/calls?id=eq.${callId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "failed", failure_reason: text }),
      });
      return NextResponse.json(
        { error: "ElevenLabs outbound call failed", details: text },
        { status: 500 }
      );
    }

    const elJson = await elRes.json();
    const conversationId = elJson.conversation_id || null;
    const callSid = elJson.callSid || null;

    await supabaseRest(`/calls?id=eq.${callId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "dialing",
        started_at: new Date().toISOString(),
        eleven_conversation_id: conversationId,
        twilio_call_sid: callSid,
      }),
    });

    return NextResponse.json({
      ok: true,
      callId,
      conversationId,
      callSid,
      toNumber,
    });
  } catch (err: any) {
    await supabaseRest(`/calls?id=eq.${callId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "failed",
        failure_reason: err?.message || "unknown_error",
      }),
    });

    return NextResponse.json(
      { error: "Call initiation crashed", details: err?.message },
      { status: 500 }
    );
  }
}
