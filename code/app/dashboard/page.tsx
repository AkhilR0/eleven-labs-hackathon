'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Heading } from '../components/ui-kit/heading'
import { Text } from '../components/ui-kit/text'
import { IconPhone, IconCalendar, IconX, IconClock, IconHistory, IconChevronRight } from '@tabler/icons-react'
import type { BootstrapResponse, Profile } from '../api/bootstrap/route'

interface ScheduledCall {
  id: string
  scheduled_for: string
  status: string
  created_at: string
}

interface Conversation {
  conversation_id: string
  start_time_unix_secs?: number
  end_time_unix_secs?: number
  call_duration_secs?: number
  status?: string
}

interface TranscriptMessage {
  role: string
  message: string
  time_in_call_secs?: number
}

export default function DashboardPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [callLoading, setCallLoading] = useState(false)
  const [callStatus, setCallStatus] = useState<string | null>(null)

  // Scheduling state
  const [scheduledCalls, setScheduledCalls] = useState<ScheduledCall[]>([])
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('')
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [showSchedule, setShowSchedule] = useState(false)

  // Conversation history state
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([])
  const [transcriptLoading, setTranscriptLoading] = useState(false)

  useEffect(() => {
    fetch('/api/bootstrap')
      .then(res => res.json())
      .then((data: BootstrapResponse) => {
        if (!data.success) {
          setError(data.error)
        } else if (data.redirect === '/onboarding') {
          router.push('/onboarding')
        } else {
          setProfile(data.profile)
          fetchScheduledCalls()
          fetchConversations()
        }
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [router])

  const fetchConversations = async () => {
    setConversationsLoading(true)
    try {
      const res = await fetch('/api/history?limit=20')
      const data = await res.json()
      if (data.ok && data.conversations) {
        setConversations(data.conversations)
      }
    } catch (err) {
      console.error('Failed to fetch conversations:', err)
    } finally {
      setConversationsLoading(false)
    }
  }

  const fetchTranscript = async (conversationId: string) => {
    setSelectedConversation(conversationId)
    setTranscriptLoading(true)
    setTranscript([])
    try {
      const res = await fetch(`/api/history?conversation_id=${conversationId}`)
      const data = await res.json()
      if (data.ok && data.conversation?.transcript) {
        setTranscript(data.conversation.transcript)
      }
    } catch (err) {
      console.error('Failed to fetch transcript:', err)
    } finally {
      setTranscriptLoading(false)
    }
  }

  const fetchScheduledCalls = async () => {
    try {
      const res = await fetch('/api/calls/schedule')
      const data = await res.json()
      if (data.success) {
        const activeCalls = data.scheduledCalls.filter(
          (c: ScheduledCall) => c.status === 'pending' || c.status === 'executing'
        )
        setScheduledCalls(activeCalls)
      }
    } catch (err) {
      console.error('Failed to fetch scheduled calls:', err)
    }
  }

  const scheduleCall = async () => {
    if (!scheduleDate || !scheduleTime) {
      setScheduleError('Please select both date and time')
      return
    }

    setScheduleLoading(true)
    setScheduleError(null)

    try {
      const scheduledFor = new Date(`${scheduleDate}T${scheduleTime}`).toISOString()
      const res = await fetch('/api/calls/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledFor }),
      })
      const data = await res.json()

      if (data.success) {
        setScheduleDate('')
        setScheduleTime('')
        setShowSchedule(false)
        fetchScheduledCalls()
      } else {
        setScheduleError(data.error)
      }
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setScheduleLoading(false)
    }
  }

  const cancelScheduledCall = async (callId: string) => {
    try {
      const res = await fetch(`/api/calls/schedule?id=${callId}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        fetchScheduledCalls()
      }
    } catch (err) {
      console.error('Failed to cancel call:', err)
    }
  }

  const startCall = async () => {
    setCallLoading(true)
    setCallStatus(null)
    try {
      const res = await fetch('/api/calls', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setCallStatus('Call started! You should receive a call shortly from (329) 777-6904.')
      } else {
        setCallStatus(`Error: ${data.error}`)
      }
    } catch (err) {
      setCallStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setCallLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-900">
        <Text>Loading...</Text>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-900">
        <div className="text-center">
          <Heading>Error</Heading>
          <Text className="mt-2 text-red-600">{error}</Text>
        </div>
      </div>
    )
  }

  if (!profile) return null

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-900">
      <div className="w-full max-w-2xl px-6">
        <div className="text-center mb-12">
          <Heading>Your Voice Has Been Cloned! Talk to Yourself:</Heading>
         
        </div>

        {/* Status messages */}
        {callStatus && (
          <div className={`mb-6 p-4 rounded-xl text-center ${
            callStatus.startsWith('Error')
              ? 'bg-red-50 text-red-600 dark:bg-red-900/20'
              : 'bg-green-50 text-green-600 dark:bg-green-900/20'
          }`}>
            {callStatus}
          </div>
        )}

        {/* Two main options */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Past - Call Now */}
          <button
            onClick={startCall}
            disabled={callLoading}
            className="group rounded-2xl border-2 border-zinc-200 bg-white p-8 text-left transition-all hover:border-indigo-500 hover:shadow-lg dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-indigo-500 disabled:opacity-50"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30">
              <IconPhone size={28} />
            </div>
            <h3 className="mt-6 text-xl font-semibold text-zinc-900 dark:text-white">
              Now
            </h3>
            <p className="mt-2 text-zinc-500 dark:text-zinc-400">
              Get a call from your future self right now
            </p>
            {callLoading && (
              <p className="mt-4 text-sm text-indigo-600">Calling...</p>
            )}
          </button>

          {/* Future - Schedule */}
          <button
            onClick={() => setShowSchedule(true)}
            className="group rounded-2xl border-2 border-zinc-200 bg-white p-8 text-left transition-all hover:border-indigo-500 hover:shadow-lg dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-indigo-500"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30">
              <IconCalendar size={28} />
            </div>
            <h3 className="mt-6 text-xl font-semibold text-zinc-900 dark:text-white">
              Later
            </h3>
            <p className="mt-2 text-zinc-500 dark:text-zinc-400">
              Schedule a call from your past self for later
            </p>
          </button>
        </div>

        {/* Scheduled Calls List */}
        {scheduledCalls.length > 0 && (
          <div className="mt-8">
            <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">
              Upcoming Calls
            </h4>
            <div className="space-y-2">
              {scheduledCalls.map((call) => (
                <div
                  key={call.id}
                  className="flex items-center justify-between rounded-xl bg-white p-4 dark:bg-zinc-800"
                >
                  <div className="flex items-center gap-3">
                    <IconClock size={18} className="text-zinc-400" />
                    <span className="text-sm text-zinc-900 dark:text-white">
                      {new Date(call.scheduled_for).toLocaleString()}
                    </span>
                  </div>
                  <button
                    onClick={() => cancelScheduledCall(call.id)}
                    className="text-zinc-400 hover:text-red-500"
                    title="Cancel"
                  >
                    <IconX size={18} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Conversation History */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <IconHistory size={20} className="text-zinc-500" />
            <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Past Conversations
            </h4>
          </div>

          {conversationsLoading ? (
            <Text className="text-sm text-zinc-500">Loading...</Text>
          ) : conversations.length === 0 ? (
            <Text className="text-sm text-zinc-500">No conversations yet. Start your first call!</Text>
          ) : (
            <div className="space-y-2">
              {conversations.map((conv) => (
                <button
                  key={conv.conversation_id}
                  onClick={() => fetchTranscript(conv.conversation_id)}
                  className="w-full flex items-center justify-between rounded-xl bg-white p-4 dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <IconPhone size={18} className="text-zinc-400" />
                    <div>
                      <span className="text-sm text-zinc-900 dark:text-white block">
                        {conv.start_time_unix_secs
                          ? new Date(conv.start_time_unix_secs * 1000).toLocaleString()
                          : 'Unknown date'}
                      </span>
                      {conv.call_duration_secs && (
                        <span className="text-xs text-zinc-500">
                          {Math.floor(conv.call_duration_secs / 60)}m {conv.call_duration_secs % 60}s
                        </span>
                      )}
                    </div>
                  </div>
                  <IconChevronRight size={18} className="text-zinc-400" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Transcript Modal */}
        {selectedConversation && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-2xl max-h-[80vh] rounded-2xl bg-white dark:bg-zinc-800 flex flex-col">
              <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-zinc-700">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
                  Conversation Transcript
                </h3>
                <button
                  onClick={() => setSelectedConversation(null)}
                  className="text-zinc-400 hover:text-zinc-600"
                >
                  <IconX size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                {transcriptLoading ? (
                  <Text className="text-center text-zinc-500">Loading transcript...</Text>
                ) : transcript.length === 0 ? (
                  <Text className="text-center text-zinc-500">No transcript available</Text>
                ) : (
                  <div className="space-y-4">
                    {transcript.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                            msg.role === 'user'
                              ? 'bg-indigo-600 text-white'
                              : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white'
                          }`}
                        >
                          <p className="text-sm">{msg.message}</p>
                          {msg.time_in_call_secs !== undefined && (
                            <p className={`text-xs mt-1 ${msg.role === 'user' ? 'text-indigo-200' : 'text-zinc-500'}`}>
                              {Math.floor(msg.time_in_call_secs / 60)}:{String(msg.time_in_call_secs % 60).padStart(2, '0')}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Schedule Modal */}
        {showSchedule && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 dark:bg-zinc-800">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
                  Schedule a Call
                </h3>
                <button
                  onClick={() => setShowSchedule(false)}
                  className="text-zinc-400 hover:text-zinc-600"
                >
                  <IconX size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    min={(() => {
                      const today = new Date();
                      return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                    })()}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Time
                  </label>
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white"
                  />
                </div>

                {scheduleError && (
                  <p className="text-sm text-red-600">{scheduleError}</p>
                )}

                <button
                  onClick={scheduleCall}
                  disabled={scheduleLoading || !scheduleDate || !scheduleTime}
                  className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {scheduleLoading ? 'Scheduling...' : 'Schedule Call'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
