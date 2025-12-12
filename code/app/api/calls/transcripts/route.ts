import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

export interface Transcript {
  id: string
  call_id: string
  transcript_json: Record<string, unknown>
  analysis_json: Record<string, unknown>
  created_at: string
  call: {
    id: string
    status: string
    started_at: string | null
    ended_at: string | null
    duration_seconds: number | null
  }
}

export type TranscriptsResponse = {
  success: true
  transcripts: Transcript[]
} | {
  success: false
  error: string
}

export async function GET(): Promise<NextResponse<TranscriptsResponse>> {
  try {
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      )
    }

    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
      return NextResponse.json(
        { success: false, error: 'Missing Supabase config' },
        { status: 500 }
      )
    }

    // Get all calls for this user that have transcripts
    // Join call_transcripts with calls to get call details
    const callsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/calls?clerk_user_id=eq.${userId}&status=eq.completed&select=id,status,started_at,ended_at,duration_seconds&order=created_at.desc`,
      {
        headers: {
          'apikey': SUPABASE_SECRET_KEY,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!callsRes.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch calls' },
        { status: 500 }
      )
    }

    const calls = await callsRes.json()

    if (!calls.length) {
      return NextResponse.json({
        success: true,
        transcripts: [],
      })
    }

    // Get transcripts for these calls
    const callIds = calls.map((c: { id: string }) => c.id)
    const transcriptsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/call_transcripts?call_id=in.(${callIds.join(',')})&select=*&order=created_at.desc`,
      {
        headers: {
          'apikey': SUPABASE_SECRET_KEY,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!transcriptsRes.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch transcripts' },
        { status: 500 }
      )
    }

    const transcriptsRaw = await transcriptsRes.json()

    // Combine transcripts with call data
    const transcripts: Transcript[] = transcriptsRaw.map((t: Record<string, unknown>) => {
      const call = calls.find((c: { id: string }) => c.id === t.call_id)
      return {
        ...t,
        call: call || null,
      }
    })

    return NextResponse.json({
      success: true,
      transcripts,
    })
  } catch (e) {
    console.error('[transcripts] Exception:', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
