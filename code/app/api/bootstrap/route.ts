import { auth, currentUser } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Types
export type SetupStatus = 'new' | 'voice_uploaded' | 'voice_created' | 'agent_created' | 'ready' | 'error'

export interface Profile {
  clerk_user_id: string
  phone_e164: string | null
  setup_status: SetupStatus
  eleven_voice_id: string | null
  eleven_agent_id: string | null
  usage_month: string
  monthly_call_count: number
  monthly_seconds_used: number
  created_at: string
  updated_at: string
}

export type BootstrapResponse = {
  success: true
  profile: Profile
  redirect: '/dashboard' | '/onboarding'
} | {
  success: false
  error: string
}

export async function GET(): Promise<NextResponse<BootstrapResponse>> {
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

    const user = await currentUser()
    const phoneE164 = user?.primaryPhoneNumber?.phoneNumber ?? null

    // Use REST API directly with new sb_secret key (no Bearer auth needed)
    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?clerk_user_id=eq.${userId}`, {
      method: 'GET',
      headers: {
        'apikey': supabaseSecretKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('[bootstrap] Fetch error:', response.status, text.slice(0, 200))
      return NextResponse.json(
        { success: false, error: `Supabase error: ${response.status}` },
        { status: 500 }
      )
    }

    const profiles = await response.json()
    let profile: Profile

    if (profiles.length === 0) {
      // Create new profile
      const createRes = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
        method: 'POST',
        headers: {
          'apikey': supabaseSecretKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          clerk_user_id: userId,
          phone_e164: phoneE164,
        }),
        cache: 'no-store',
      })

      if (!createRes.ok) {
        const text = await createRes.text()
        return NextResponse.json(
          { success: false, error: `Create error: ${text.slice(0, 100)}` },
          { status: 500 }
        )
      }

      const created = await createRes.json()
      profile = created[0]
    } else {
      profile = profiles[0]

      // Update phone if changed
      if (profile.phone_e164 !== phoneE164) {
        await fetch(`${supabaseUrl}/rest/v1/profiles?clerk_user_id=eq.${userId}`, {
          method: 'PATCH',
          headers: {
            'apikey': supabaseSecretKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            phone_e164: phoneE164,
            updated_at: new Date().toISOString(),
          }),
          cache: 'no-store',
        })
      }
    }

    const isReady = profile.setup_status === 'ready'
    const hasAgent = !!profile.eleven_agent_id
    const redirect = (isReady && hasAgent) ? '/dashboard' : '/onboarding'

    return NextResponse.json({ success: true, profile, redirect })
  } catch (e) {
    console.error('[bootstrap] Exception:', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
