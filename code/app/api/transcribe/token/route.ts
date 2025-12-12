import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;

// Get a single-use token for ElevenLabs realtime STT
export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ELEVENLABS_API_KEY) {
    return NextResponse.json({ error: "Missing ElevenLabs API key" }, { status: 500 });
  }

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: data.detail || "Failed to get token" }, { status: res.status });
    }

    return NextResponse.json({ ok: true, token: data.token });
  } catch (err) {
    console.error("[transcribe/token] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
