'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import OnboardingForm from './onboarding-form'
import type { BootstrapResponse, Profile } from '../api/bootstrap/route'

export default function OnboardingPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/bootstrap')
      .then(res => res.json())
      .then((data: BootstrapResponse) => {
        if (!data.success) {
          setError(data.error)
        } else if (data.redirect === '/dashboard') {
          router.push('/dashboard')
        } else {
          setProfile(data.profile)
        }
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [router])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600">Error</h1>
          <p className="mt-2 text-zinc-600">{error}</p>
        </div>
      </div>
    )
  }

  if (!profile) return null

  return <OnboardingForm profile={profile} />
}
