import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export type UploadUrlResponse = {
  success: true
  uploadUrl: string
  storagePath: string
} | {
  success: false
  error: string
}

export async function POST(): Promise<NextResponse<UploadUrlResponse>> {
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

    // Generate unique filename
    const timestamp = Date.now()
    const storagePath = `${userId}/${timestamp}.webm`

    // Create signed upload URL using Supabase Storage API
    const response = await fetch(
      `${supabaseUrl}/storage/v1/object/upload/sign/voice-samples/${storagePath}`,
      {
        method: 'POST',
        headers: {
          'apikey': supabaseSecretKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    )

    if (!response.ok) {
      const text = await response.text()
      console.error('[upload-url] Failed to create signed URL:', response.status, text)
      return NextResponse.json(
        { success: false, error: 'Failed to create upload URL' },
        { status: 500 }
      )
    }

    const data = await response.json()

    // The signed URL is relative, we need to make it absolute
    const uploadUrl = `${supabaseUrl}/storage/v1${data.url}`

    return NextResponse.json({
      success: true,
      uploadUrl,
      storagePath: `voice-samples/${storagePath}`,
    })
  } catch (e) {
    console.error('[upload-url] Exception:', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
