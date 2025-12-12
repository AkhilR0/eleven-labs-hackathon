import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;

function requireEnv() {
  for (const [k, v] of Object.entries({
    SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    ELEVENLABS_API_KEY,
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

async function elevenGet(url: string) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      Accept: "application/json",
    },
  });

  const text = await res.text().catch(() => "");
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}

  return { ok: res.ok, status: res.status, text, json };
}

export async function GET(req: Request) {
  requireEnv();

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 1) Get this user's agent id from Supabase
  const profileRes = await supabaseRest(
    `/profiles?clerk_user_id=eq.${userId}&select=eleven_agent_id`
  );
  if (!profileRes.ok) {
    const t = await profileRes.text().catch(() => "");
    return NextResponse.json({ error: "Failed to fetch profile", details: t }, { status: 500 });
  }

  const profiles = await profileRes.json();
  const agentId = profiles?.[0]?.eleven_agent_id as string | undefined;
  if (!agentId) return NextResponse.json({ error: "No agent found for user" }, { status: 400 });

  const url = new URL(req.url);
  const conversationId =
    url.searchParams.get("conversation_id") || url.searchParams.get("id");

  // 2) If a conversation_id is provided: return full details (includes transcript/timings)
  if (conversationId) {
    const r = await elevenGet(
      `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`
    );
    if (!r.ok) {
      return NextResponse.json(
        { error: "Failed to fetch conversation details", status: r.status, details: r.text },
        { status: 500 }
      );
    }

    // Safety: ensure it belongs to this user's agent
    const convAgentId = r.json?.agent_id;
    if (convAgentId && convAgentId !== agentId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ ok: true, conversation: r.json });
  }

  // 3) Otherwise: list conversations for this agent
  const limit = Math.min(Number(url.searchParams.get("limit") || "20"), 100);
  const cursor = url.searchParams.get("cursor");

  const qs = new URLSearchParams();
  qs.set("agent_id", agentId);
  qs.set("page_size", String(limit)); // supported by list endpoint
  if (cursor) qs.set("cursor", cursor);

  const r = await elevenGet(`https://api.elevenlabs.io/v1/convai/conversations?${qs.toString()}`);
  if (!r.ok) {
    return NextResponse.json(
      { error: "Failed to list conversations", status: r.status, details: r.text },
      { status: 500 }
    );
  }

  // Pass through whatever ElevenLabs returns (usually { conversations: [...], cursor: ... } etc.)
  return NextResponse.json({ ok: true, ...r.json });
}
