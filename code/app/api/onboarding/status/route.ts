import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export type OnboardingStatus = 'queued' | 'processing' | 'voice_created' | 'agent_created' | 'completed' | 'failed'

export type StatusResponse = {
  success: true
  jobId: string
  status: OnboardingStatus
  errorMessage?: string
  profile: {
    setup_status: string
    eleven_voice_id: string | null
    eleven_agent_id: string | null
  }
} | {
  success: false
  error: string
}

export async function GET(request: NextRequest): Promise<NextResponse<StatusResponse>> {
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

    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get('job_id')

    if (!jobId) {
      return NextResponse.json(
        { success: false, error: 'job_id is required' },
        { status: 400 }
      )
    }

    // Handle special case for already complete
    if (jobId === 'already_complete') {
      const profileRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?clerk_user_id=eq.${userId}&select=setup_status,eleven_voice_id,eleven_agent_id`,
        {
          headers: {
            'apikey': supabaseSecretKey,
            'Content-Type': 'application/json',
          },
        }
      )

      if (profileRes.ok) {
        const profiles = await profileRes.json()
        if (profiles.length > 0) {
          return NextResponse.json({
            success: true,
            jobId: 'already_complete',
            status: 'completed',
            profile: profiles[0],
          })
        }
      }
    }

    // Handle "latest" - fetch most recent job for user
    let jobQuery = `${supabaseUrl}/rest/v1/onboarding_jobs?clerk_user_id=eq.${userId}&select=*&order=created_at.desc&limit=1`
    if (jobId !== 'latest') {
      jobQuery = `${supabaseUrl}/rest/v1/onboarding_jobs?id=eq.${jobId}&clerk_user_id=eq.${userId}&select=*`
    }

    // Fetch job status
    const jobRes = await fetch(jobQuery, {
      headers: {
        'apikey': supabaseSecretKey,
        'Content-Type': 'application/json',
      },
    })

    if (!jobRes.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch job status' },
        { status: 500 }
      )
    }

    const jobs = await jobRes.json()
    if (jobs.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Job not found' },
        { status: 404 }
      )
    }

    const job = jobs[0]

    // Also fetch current profile status
    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?clerk_user_id=eq.${userId}&select=setup_status,eleven_voice_id,eleven_agent_id`,
      {
        headers: {
          'apikey': supabaseSecretKey,
          'Content-Type': 'application/json',
        },
      }
    )

    let profile = { setup_status: 'unknown', eleven_voice_id: null, eleven_agent_id: null }
    if (profileRes.ok) {
      const profiles = await profileRes.json()
      if (profiles.length > 0) {
        profile = profiles[0]
      }
    }

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: job.status,
      errorMessage: job.error_message,
      profile,
    })
  } catch (e) {
    console.error('[status] Exception:', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
