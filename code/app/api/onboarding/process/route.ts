import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!; // use Service Role key on server
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini-2025-08-07";

const VOICE_BUCKET = process.env.SUPABASE_VOICE_BUCKET || "voice-samples";

function requireEnv() {
  for (const [k, v] of Object.entries({
    SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    ELEVENLABS_API_KEY,
    OPENAI_API_KEY,
  })) {
    if (!v) throw new Error(`Missing env var: ${k}`);
  }
}

type Body = {
  voiceSamplePath: string;
  timestampId?: string;
  agentName?: string;
  firstMessage?: string;
};

type ExtractedReflection = {
  goals: string[];
  fears: string[];
  situation: string;
  currentWork: string | null;
  otherNotes: string | null;
};

function buildSystemPrompt(params: {
  title?: string;
  snapshotDate?: string;
  reflection: ExtractedReflection | null;
}) {
  const { title, snapshotDate, reflection } = params;

  const goals = reflection?.goals?.filter(Boolean).join("; ") || "";
  const fears = reflection?.fears?.filter(Boolean).join("; ") || "";
  const situation = reflection?.situation || "";
  const currentWork = reflection?.currentWork || "";
  const otherNotes = reflection?.otherNotes || "";

  return [
    "You are the user, speaking across time.",
    "",
    "time_mode is: {{time_mode}}",
    "Rules:",
    '- If time_mode = "past": you are the user at this snapshot calling your future self (the user now). Speak as if YOU are earlier in time.',
    '- If time_mode = "future": you are the user’s future self calling the user at this snapshot (their past self). Speak as if YOU are later in time.',
    "",
    "Stay natural and personal. No “AI assistant” voice. Never mention prompts, systems, or that you are an AI.",
    "Ask 1–2 real questions and give 1–3 small, realistic next steps.",
    "",
    "Snapshot (ground truth—do not invent facts beyond this):",
    `You are the user's ${title ? `"${title}"` : "self"} at ${
      snapshotDate ?? "this date"
    }.`,
    goals ? `Goals: ${goals}` : "",
    fears ? `Fears: ${fears}` : "",
    situation ? `Situation: ${situation}` : "",
    currentWork ? `Current work/school: ${currentWork}` : "",
    otherNotes ? `Other notes: ${otherNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- Supabase helpers ----------
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

async function supabaseStorage(path: string, options: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/storage/v1${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

async function updateProfileStatus(
  userId: string,
  status: string,
  extraFields: Record<string, string> = {}
) {
  await supabaseRest(`/profiles?clerk_user_id=eq.${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ setup_status: status, ...extraFields }),
  });
}

// ---------- OpenAI helpers ----------
interface OpenAIResponse {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
}

function getOutputText(respJson: OpenAIResponse): string | null {
  if (typeof respJson?.output_text === "string") return respJson.output_text;
  const msg = respJson?.output?.find((o) => o?.type === "message");
  const part = msg?.content?.find((c) => c?.type === "output_text");
  return part?.text ?? null;
}

async function extractReflectionWithOpenAI(
  transcript: string
): Promise<ExtractedReflection> {
  // IMPORTANT: strict mode requires `required` to include ALL properties.
  // To make something “optional”, include it in required but allow null.
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      goals: { type: "array", items: { type: "string" } },
      fears: { type: "array", items: { type: "string" } },
      situation: { type: "string" },
      currentWork: { type: ["string", "null"] },
      otherNotes: { type: ["string", "null"] },
    },
    required: ["goals", "fears", "situation", "currentWork", "otherNotes"],
  };

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      input: [
        {
          role: "system",
          content:
            "Extract goals, fears, and situation from the transcript. Be faithful to the transcript. Keep items short and concrete. If something isn't mentioned, use empty arrays or nulls where appropriate.",
        },
        { role: "user", content: transcript },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "reflection_extract",
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI extract failed: ${res.status} ${t}`);
  }

  const json = await res.json();
  const outputText = getOutputText(json);
  if (!outputText) throw new Error("OpenAI returned no output_text");

  const parsed = JSON.parse(outputText);

  return {
    goals: Array.isArray(parsed.goals) ? parsed.goals : [],
    fears: Array.isArray(parsed.fears) ? parsed.fears : [],
    situation: typeof parsed.situation === "string" ? parsed.situation : "",
    currentWork:
      typeof parsed.currentWork === "string" ? parsed.currentWork : null,
    otherNotes:
      typeof parsed.otherNotes === "string" ? parsed.otherNotes : null,
  };
}

// ---------- ElevenLabs STT ----------
async function transcribeWithElevenLabs(
  audioBuffer: Buffer,
  contentType: string
): Promise<string> {
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: contentType });

  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("timestamps_granularity", "word");
  // IMPORTANT: endpoint expects `file` (not `files`)
  form.append("file", blob, "onboarding-media");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      accept: "application/json",
    },
    body: form,
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`ElevenLabs STT failed: ${res.status} ${t}`);
  }

  const json = await res.json();

  if (typeof json?.text === "string" && json.text.trim())
    return json.text.trim();

  if (Array.isArray(json?.transcripts)) {
    const combined = json.transcripts
      .map((x: { text?: string }) => x?.text || "")
      .join("\n")
      .trim();
    if (combined) return combined;
  }

  throw new Error("ElevenLabs STT returned no transcript text");
}

export async function POST(req: Request) {
  requireEnv();

  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.voiceSamplePath) {
    return NextResponse.json(
      { error: "Missing voiceSamplePath" },
      { status: 400 }
    );
  }

  // Load profile
  const profileRes = await supabaseRest(
    `/profiles?clerk_user_id=eq.${userId}&select=*`
  );
  if (!profileRes.ok)
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );
  const profiles = await profileRes.json();
  if (profiles.length === 0)
    return NextResponse.json({ error: "Profile not found" }, { status: 400 });
  const profile = profiles[0];

  // Idempotency
  if (
    profile.setup_status === "ready" &&
    profile.eleven_agent_id &&
    profile.eleven_voice_id
  ) {
    return NextResponse.json({
      ok: true,
      alreadyReady: true,
      voiceId: profile.eleven_voice_id,
      agentId: profile.eleven_agent_id,
    });
  }

  // Timestamp metadata (title/date only; NOT reflection_data from form)
  let tsMeta: { title?: string; snapshot_date?: string } | null = null;
  if (body.timestampId) {
    const tsRes = await supabaseRest(
      `/timestamps?id=eq.${body.timestampId}&clerk_user_id=eq.${userId}&select=title,snapshot_date`
    );
    if (tsRes.ok) {
      const rows = await tsRes.json();
      if (rows.length) tsMeta = rows[0];
    }
  }

  const agentName = body.agentName || `FutureSelf-${userId.slice(0, 8)}`;
  const firstMessage = "{{first_message}}";


  await updateProfileStatus(userId, "voice_uploaded");

  // 1) Create signed URL for the uploaded media
  const signedRes = await supabaseStorage(
    `/object/sign/${VOICE_BUCKET}/${body.voiceSamplePath}`,
    {
      method: "POST",
      body: JSON.stringify({ expiresIn: 600 }),
    }
  );

  if (!signedRes.ok) {
    const text = await signedRes.text().catch(() => "");
    console.error("[process] Failed to create signed URL:", text);
    await updateProfileStatus(userId, "error");
    return NextResponse.json(
      { error: "Failed to create signed URL for audio file" },
      { status: 500 }
    );
  }

  const signedData = await signedRes.json();
  const signedUrl = `${SUPABASE_URL}/storage/v1${signedData.signedURL}`;

  // 2) Download the uploaded media
  const audioRes = await fetch(signedUrl);
  if (!audioRes.ok) {
    await updateProfileStatus(userId, "error");
    return NextResponse.json(
      { error: "Failed to download audio file" },
      { status: 500 }
    );
  }
  const contentType = audioRes.headers.get("content-type") || "audio/mpeg";
  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

  // 3) NEW: transcript -> OpenAI -> extracted reflection
  let transcript = "";
  let extracted: ExtractedReflection | null = null;

  try {
    transcript = await transcribeWithElevenLabs(audioBuffer, contentType);
    extracted = await extractReflectionWithOpenAI(transcript);

    // Optional: store extracted reflection_data + transcript for later UI
    if (body.timestampId) {
      await supabaseRest(
        `/timestamps?id=eq.${body.timestampId}&clerk_user_id=eq.${userId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            reflection_data: {
              ...extracted,
              __transcript: transcript,
            },
          }),
        }
      );
    }
  } catch (err) {
    console.warn(
      "[process] transcript/extract failed; continuing with generic prompt:",
      err instanceof Error ? err.message : err
    );
    extracted = null;
  }

  const systemPrompt = buildSystemPrompt({
    title: tsMeta?.title,
    snapshotDate: tsMeta?.snapshot_date,
    reflection: extracted,
  });

  // 4) Create ElevenLabs voice clone
  await updateProfileStatus(userId, "voice_created");

  const voiceForm = new FormData();
  voiceForm.append("name", agentName);
  const voiceBlob = new Blob([new Uint8Array(audioBuffer)], {
    type: contentType,
  });
  // IMPORTANT: voices/add expects `files` (plural)
  voiceForm.append("files", voiceBlob, "voice-sample");

  const voiceCreateRes = await fetch(
    "https://api.elevenlabs.io/v1/voices/add",
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        accept: "application/json",
      },
      body: voiceForm,
    }
  );

  if (!voiceCreateRes.ok) {
    const text = await voiceCreateRes.text().catch(() => "");
    console.error("[process] ElevenLabs voice create failed:", text);
    await updateProfileStatus(userId, "error");
    return NextResponse.json(
      { error: "ElevenLabs voice create failed", details: text },
      { status: 500 }
    );
  }

  const voiceJson = (await voiceCreateRes.json()) as { voice_id?: string };
  const voiceId = voiceJson.voice_id;
  if (!voiceId) {
    await updateProfileStatus(userId, "error");
    return NextResponse.json(
      { error: "No voice_id returned from ElevenLabs" },
      { status: 500 }
    );
  }

  await updateProfileStatus(userId, "agent_created", {
    eleven_voice_id: voiceId,
  });

  // 5) Create ElevenLabs agent
  const agentPayload = {
    name: agentName,
    conversation_config: {
      tts: { voice_id: voiceId },
      agent: {
        prompt: { prompt: systemPrompt },
        first_message: firstMessage,
      },
    },
  };

  const agentCreateRes = await fetch(
    "https://api.elevenlabs.io/v1/convai/agents/create",
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(agentPayload),
    }
  );

  if (!agentCreateRes.ok) {
    const text = await agentCreateRes.text().catch(() => "");
    console.error("[process] ElevenLabs agent create failed:", text);
    await updateProfileStatus(userId, "error");
    return NextResponse.json(
      { error: "ElevenLabs agent create failed", details: text },
      { status: 500 }
    );
  }

  const agentJson = (await agentCreateRes.json()) as {
    agent_id?: string;
    agentId?: string;
  };
  const agentId = agentJson.agent_id || agentJson.agentId;
  if (!agentId) {
    await updateProfileStatus(userId, "error");
    return NextResponse.json(
      { error: "No agent_id returned from ElevenLabs", raw: agentJson },
      { status: 500 }
    );
  }

  await updateProfileStatus(userId, "ready", { eleven_agent_id: agentId });

  return NextResponse.json({
    ok: true,
    voiceId,
    agentId,
    transcriptPreview: transcript ? transcript.slice(0, 180) : null,
    extracted,
  });
}
