import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

export type ScheduleCallResponse = {
  success: true
  scheduledCall: {
    id: string
    scheduled_for: string
    status: string
  }
} | {
  success: false
  error: string
}

export async function POST(request: NextRequest): Promise<NextResponse<ScheduleCallResponse>> {
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

    const body = await request.json()
    const { scheduledFor } = body

    if (!scheduledFor) {
      return NextResponse.json(
        { success: false, error: 'scheduledFor is required' },
        { status: 400 }
      )
    }

    // Validate the date is in the future
    const scheduledDate = new Date(scheduledFor)
    if (scheduledDate <= new Date()) {
      return NextResponse.json(
        { success: false, error: 'Scheduled time must be in the future' },
        { status: 400 }
      )
    }

    // Get user's latest timestamp
    const timestampRes = await fetch(
      `${SUPABASE_URL}/rest/v1/timestamps?clerk_user_id=eq.${userId}&order=created_at.desc&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_SECRET_KEY,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!timestampRes.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch timestamp' },
        { status: 500 }
      )
    }

    const timestamps = await timestampRes.json()
    if (timestamps.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No timestamp found. Complete onboarding first.' },
        { status: 400 }
      )
    }

    const timestampId = timestamps[0].id

    // Create scheduled call
    const scheduleRes = await fetch(`${SUPABASE_URL}/rest/v1/scheduled_calls`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SECRET_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        clerk_user_id: userId,
        timestamp_id: timestampId,
        scheduled_for: scheduledFor,
        status: 'pending',
      }),
    })

    if (!scheduleRes.ok) {
      const text = await scheduleRes.text()
      console.error('[schedule] Failed to create scheduled call:', text)
      return NextResponse.json(
        { success: false, error: 'Failed to schedule call' },
        { status: 500 }
      )
    }

    const scheduledCalls = await scheduleRes.json()
    const scheduledCall = scheduledCalls[0]

    return NextResponse.json({
      success: true,
      scheduledCall: {
        id: scheduledCall.id,
        scheduled_for: scheduledCall.scheduled_for,
        status: scheduledCall.status,
      },
    })
  } catch (e) {
    console.error('[schedule] Exception:', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET - List scheduled calls for user
export async function GET(): Promise<NextResponse> {
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

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/scheduled_calls?clerk_user_id=eq.${userId}&order=scheduled_for.asc`,
      {
        headers: {
          'apikey': SUPABASE_SECRET_KEY,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch scheduled calls' },
        { status: 500 }
      )
    }

    const scheduledCalls = await res.json()

    return NextResponse.json({
      success: true,
      scheduledCalls,
    })
  } catch (e) {
    console.error('[schedule] GET Exception:', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// DELETE - Cancel a scheduled call
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const callId = searchParams.get('id')

    if (!callId) {
      return NextResponse.json(
        { success: false, error: 'Call ID is required' },
        { status: 400 }
      )
    }

    // Update status to canceled
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/scheduled_calls?id=eq.${callId}&clerk_user_id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SECRET_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'canceled',
          updated_at: new Date().toISOString(),
        }),
      }
    )

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to cancel scheduled call' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[schedule] DELETE Exception:', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
