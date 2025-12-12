import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

interface EnqueueRequest {
  goals: string
  fears: string
  currentWork: string
  audioStoragePath: string
}

export type EnqueueResponse = {
  success: true
  jobId: string
  timestampId: string
  status: string
} | {
  success: false
  error: string
}

export async function POST(request: NextRequest): Promise<NextResponse<EnqueueResponse>> {
  try {
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY

    if (!supabaseUrl || !supabaseSecretKey) {
      return NextResponse.json(
        { success: false, error: 'Missing Supabase config' },
        { status: 500 }
      )
    }

    const body: EnqueueRequest = await request.json()
    const { goals, fears, currentWork, audioStoragePath } = body

    // Validate required fields
    if (!audioStoragePath) {
      return NextResponse.json(
        { success: false, error: 'Audio storage path is required' },
        { status: 400 }
      )
    }

    // Fetch profile to validate it exists and check status
    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?clerk_user_id=eq.${userId}&select=*`,
      {
        headers: {
          'apikey': supabaseSecretKey,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!profileRes.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch profile' },
        { status: 500 }
      )
    }

    const profiles = await profileRes.json()
    if (profiles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Profile not found' },
        { status: 404 }
      )
    }

    const profile = profiles[0]

    if (!profile.phone_e164) {
      return NextResponse.json(
        { success: false, error: 'Phone number is required. Please add a phone number to your account.' },
        { status: 400 }
      )
    }

    if (['voice_uploaded', 'voice_created', 'agent_created', 'ready'].includes(profile.setup_status)) {
      // Find existing job
      const existingJobRes = await fetch(
        `${supabaseUrl}/rest/v1/onboarding_jobs?clerk_user_id=eq.${userId}&order=created_at.desc&limit=1`,
        {
          headers: {
            'apikey': supabaseSecretKey,
            'Content-Type': 'application/json',
          },
        }
      )

      if (existingJobRes.ok) {
        const existingJobs = await existingJobRes.json()
        if (existingJobs.length > 0) {
          return NextResponse.json({
            success: true,
            jobId: existingJobs[0].id,
            timestampId: existingJobs[0].timestamp_id,
            status: existingJobs[0].status,
          })
        }
      }

      // If already ready, just return success
      if (profile.setup_status === 'ready') {
        return NextResponse.json({
          success: true,
          jobId: 'already_complete',
          timestampId: 'already_complete',
          status: 'completed',
        })
      }
    }

    // Create timestamp row with reflection data
    const timestampRes = await fetch(`${supabaseUrl}/rest/v1/timestamps`, {
      method: 'POST',
      headers: {
        'apikey': supabaseSecretKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        clerk_user_id: userId,
        title: 'My past self',
        reflection_data: {
          goals,
          fears,
          currentWork,
        },
      }),
    })

    if (!timestampRes.ok) {
      const text = await timestampRes.text()
      console.error('[enqueue] Failed to create timestamp:', text)
      return NextResponse.json(
        { success: false, error: 'Failed to save reflection data' },
        { status: 500 }
      )
    }

    const timestamps = await timestampRes.json()
    const timestamp = timestamps[0]

    // Create voice_samples row
    await fetch(`${supabaseUrl}/rest/v1/voice_samples`, {
      method: 'POST',
      headers: {
        'apikey': supabaseSecretKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clerk_user_id: userId,
        timestamp_id: timestamp.id,
        storage_path: audioStoragePath,
      }),
    })

    // Create onboarding_jobs row
    const jobRes = await fetch(`${supabaseUrl}/rest/v1/onboarding_jobs`, {
      method: 'POST',
      headers: {
        'apikey': supabaseSecretKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        clerk_user_id: userId,
        timestamp_id: timestamp.id,
        audio_storage_path: audioStoragePath,
        status: 'queued',
      }),
    })

    if (!jobRes.ok) {
      const text = await jobRes.text()
      console.error('[enqueue] Failed to create job:', text)
      return NextResponse.json(
        { success: false, error: 'Failed to create onboarding job' },
        { status: 500 }
      )
    }

    const jobs = await jobRes.json()
    const job = jobs[0]

    // Update profile status to voice_uploaded
    await fetch(
      `${supabaseUrl}/rest/v1/profiles?clerk_user_id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': supabaseSecretKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          setup_status: 'voice_uploaded',
          updated_at: new Date().toISOString(),
        }),
      }
    )

    return NextResponse.json({
      success: true,
      jobId: job.id,
      timestampId: timestamp.id,
      status: job.status,
    })
  } catch (e) {
    console.error('[enqueue] Exception:', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
