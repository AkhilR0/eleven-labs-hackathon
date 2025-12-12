'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Heading } from '../components/ui-kit/heading'
import { Text } from '../components/ui-kit/text'
import { Button } from '../components/ui-kit/button'
import { IconMicrophone, IconPlayerStop, IconX, IconCheck, IconLoader2 } from '@tabler/icons-react'
import type { Profile } from '../api/bootstrap/route'
import type { UploadUrlResponse } from '../api/storage/upload-url/route'
import type { EnqueueResponse } from '../api/onboarding/enqueue/route'
import type { StatusResponse, OnboardingStatus } from '../api/onboarding/status/route'

interface OnboardingFormProps {
  profile: Profile
}

type SubmitState = 'idle' | 'uploading' | 'enqueuing' | 'processing' | 'completed' | 'error'

const MIN_RECORDING_SECONDS = 30

interface CategoryProgress {
  goals: boolean;
  fears: boolean;
  working_on: boolean;
}

interface CategoryExcerpts {
  goals: string[];
  fears: string[];
  working_on: string[];
}

export default function OnboardingForm({ profile }: OnboardingFormProps) {
  const router = useRouter()
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // Live transcription state
  const [transcript, setTranscript] = useState('')  // Committed transcript
  const [partialTranscript, setPartialTranscript] = useState('')  // Real-time partial
  const [categoryProgress, setCategoryProgress] = useState<CategoryProgress>({
    goals: false,
    fears: false,
    working_on: false,
  })
  const [categoryExcerpts, setCategoryExcerpts] = useState<CategoryExcerpts>({
    goals: [],
    fears: [],
    working_on: [],
  })
  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastCheckTimeRef = useRef<number>(0)

  // Submission state - check if already in progress based on profile status
  const isAlreadyProcessing = ['voice_uploaded', 'voice_created', 'agent_created'].includes(profile.setup_status)
  const [submitState, setSubmitState] = useState<SubmitState>(isAlreadyProcessing ? 'processing' : 'idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<OnboardingStatus>(
    profile.setup_status === 'voice_uploaded' ? 'queued' :
    profile.setup_status === 'voice_created' ? 'voice_created' :
    profile.setup_status === 'agent_created' ? 'agent_created' :
    'queued'
  )

  // Fetch existing job on mount if already processing
  useEffect(() => {
    if (!isAlreadyProcessing) return

    const fetchExistingJob = async () => {
      try {
        const res = await fetch('/api/onboarding/status?job_id=latest')
        const data: StatusResponse = await res.json()
        if (data.success) {
          setJobId(data.jobId)
          setJobStatus(data.status)
          if (data.status === 'completed') {
            setSubmitState('completed')
            setTimeout(() => router.push('/dashboard'), 2000)
          } else if (data.status === 'failed') {
            setSubmitState('error')
            setSubmitError(data.errorMessage || 'Processing failed')
          }
        }
      } catch (err) {
        console.error('Failed to fetch existing job:', err)
      }
    }

    fetchExistingJob()
  }, [isAlreadyProcessing, router])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []
      setRecordingSeconds(0)

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setRecordedBlob(blob)
        const url = URL.createObjectURL(blob)
        setAudioUrl(url)
        stream.getTracks().forEach(track => track.stop())
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
      }

      mediaRecorder.start()
      setIsRecording(true)

      // Start live transcription
      startTranscription(stream)

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingSeconds(s => s + 1)
      }, 1000)
    } catch (err) {
      console.error('Error accessing microphone:', err)
      alert('Could not access microphone. Please check permissions.')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
    // Cleanup WebSocket and audio processing
    cleanupTranscription()
  }

  const cleanupTranscription = () => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current)
      checkIntervalRef.current = null
    }
  }

  const checkCategoryProgress = async (currentTranscript: string) => {
    // Don't check too frequently (at least 3 seconds between checks)
    const now = Date.now()
    if (now - lastCheckTimeRef.current < 3000) return
    lastCheckTimeRef.current = now

    // Don't check if transcript is too short
    if (currentTranscript.length < 20) return

    try {
      const res = await fetch('/api/transcribe/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: currentTranscript }),
      })
      const data = await res.json()
      if (data.ok && data.categories) {
        // Only update to true, never back to false
        setCategoryProgress(prev => ({
          goals: prev.goals || data.categories.goals.found,
          fears: prev.fears || data.categories.fears.found,
          working_on: prev.working_on || data.categories.working_on.found,
        }))
        // Accumulate excerpts (add new ones, avoid duplicates)
        setCategoryExcerpts(prev => ({
          goals: [...new Set([...prev.goals, ...data.categories.goals.excerpts])],
          fears: [...new Set([...prev.fears, ...data.categories.fears.excerpts])],
          working_on: [...new Set([...prev.working_on, ...data.categories.working_on.excerpts])],
        }))
      }
    } catch (err) {
      console.error('Category check error:', err)
    }
  }

  const startTranscription = async (stream: MediaStream) => {
    try {
      // Get single-use token from our API
      const tokenRes = await fetch('/api/transcribe/token', { method: 'POST' })
      const tokenData = await tokenRes.json()
      if (!tokenData.ok || !tokenData.token) {
        console.error('Failed to get transcription token:', tokenData)
        return
      }

      // Connect to ElevenLabs WebSocket with token
      // Using commit_strategy=vad for automatic voice activity detection
      const wsUrl = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?token=${tokenData.token}&model_id=scribe_v2_realtime&language_code=en&audio_format=pcm_16000&commit_strategy=vad`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        console.log('Transcription WebSocket connected')
        // Start sending audio
        startAudioStreaming(stream)
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          console.log('[STT] Received:', msg.message_type, msg)

          if (msg.message_type === 'partial_transcript') {
            // Show partial transcript in real-time as user speaks
            setPartialTranscript(msg.text || '')
          } else if (msg.message_type === 'committed_transcript' && msg.text) {
            // Clear partial and add to committed transcript
            setPartialTranscript('')
            setTranscript(prev => {
              const newTranscript = prev + ' ' + msg.text
              // Trigger category check
              checkCategoryProgress(newTranscript.trim())
              return newTranscript.trim()
            })
          } else if (msg.message_type === 'committed_transcript_with_timestamps' && msg.text) {
            // Clear partial and add to committed transcript
            setPartialTranscript('')
            setTranscript(prev => {
              const newTranscript = prev + ' ' + msg.text
              checkCategoryProgress(newTranscript.trim())
              return newTranscript.trim()
            })
          }
        } catch (err) {
          console.error('WebSocket message parse error:', err)
        }
      }

      ws.onerror = (err) => {
        console.error('Transcription WebSocket error:', err)
      }

      ws.onclose = () => {
        console.log('Transcription WebSocket closed')
      }

      // Set up periodic category checking every 5 seconds
      checkIntervalRef.current = setInterval(() => {
        setTranscript(current => {
          if (current.length > 20) {
            checkCategoryProgress(current)
          }
          return current
        })
      }, 5000)

    } catch (err) {
      console.error('Start transcription error:', err)
    }
  }

  const startAudioStreaming = (stream: MediaStream) => {
    const audioContext = new AudioContext({ sampleRate: 16000 })
    audioContextRef.current = audioContext

    const source = audioContext.createMediaStreamSource(stream)
    sourceRef.current = source

    // Use ScriptProcessorNode to get raw PCM data
    const processor = audioContext.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor

    let chunkCount = 0
    processor.onaudioprocess = (e) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return

      const inputData = e.inputBuffer.getChannelData(0)
      // Convert float32 to int16
      const int16Data = new Int16Array(inputData.length)
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]))
        int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
      }

      // Convert to base64
      const uint8Array = new Uint8Array(int16Data.buffer)
      const base64 = btoa(String.fromCharCode(...uint8Array))

      // Send to WebSocket
      wsRef.current.send(JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: base64,
        commit: false,
        sample_rate: 16000,
      }))

      chunkCount++
      if (chunkCount % 50 === 0) {
        console.log('[STT] Sent', chunkCount, 'audio chunks')
      }
    }

    source.connect(processor)
    processor.connect(audioContext.destination)
  }

  const clearAudio = () => {
    setRecordedBlob(null)
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
      setAudioUrl(null)
    }
    setRecordingSeconds(0)
    // Reset transcription state
    setTranscript('')
    setPartialTranscript('')
    setCategoryProgress({ goals: false, fears: false, working_on: false })
    setCategoryExcerpts({ goals: [], fears: [], working_on: [] })
    cleanupTranscription()
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Highlight excerpts in transcript with different colors
  const renderHighlightedTranscript = () => {
    if (!transcript) return null

    // Create a map of positions to highlight info
    type HighlightInfo = { category: 'goals' | 'fears' | 'working_on'; start: number; end: number }
    const highlights: HighlightInfo[] = []

    // Find all excerpt positions in the transcript (case-insensitive)
    const addHighlights = (excerpts: string[], category: 'goals' | 'fears' | 'working_on') => {
      excerpts.forEach(excerpt => {
        const lowerTranscript = transcript.toLowerCase()
        const lowerExcerpt = excerpt.toLowerCase()
        let pos = 0
        while ((pos = lowerTranscript.indexOf(lowerExcerpt, pos)) !== -1) {
          highlights.push({ category, start: pos, end: pos + excerpt.length })
          pos += excerpt.length
        }
      })
    }

    addHighlights(categoryExcerpts.goals, 'goals')
    addHighlights(categoryExcerpts.fears, 'fears')
    addHighlights(categoryExcerpts.working_on, 'working_on')

    // Sort by start position
    highlights.sort((a, b) => a.start - b.start)

    // Build highlighted segments (handle overlaps by using first match)
    const segments: React.ReactNode[] = []
    let lastEnd = 0

    highlights.forEach((h, idx) => {
      if (h.start < lastEnd) return // Skip overlapping highlights

      // Add unhighlighted text before this highlight
      if (h.start > lastEnd) {
        segments.push(
          <span key={`plain-${idx}`}>{transcript.slice(lastEnd, h.start)}</span>
        )
      }

      // Add highlighted text - more prominent colors
      const colorClass =
        h.category === 'goals' ? 'bg-indigo-300 dark:bg-indigo-600/70 text-indigo-900 dark:text-indigo-100' :
        h.category === 'fears' ? 'bg-amber-300 dark:bg-amber-600/70 text-amber-900 dark:text-amber-100' :
        'bg-emerald-300 dark:bg-emerald-600/70 text-emerald-900 dark:text-emerald-100'

      segments.push(
        <span key={`highlight-${idx}`} className={`${colorClass} rounded px-1 py-0.5 font-medium`}>
          {transcript.slice(h.start, h.end)}
        </span>
      )

      lastEnd = h.end
    })

    // Add remaining text
    if (lastEnd < transcript.length) {
      segments.push(<span key="plain-end">{transcript.slice(lastEnd)}</span>)
    }

    return segments.length > 0 ? segments : transcript
  }

  // Poll for job status
  const pollStatus = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/onboarding/status?job_id=${id}`)
      const data: StatusResponse = await res.json()

      if (!data.success) {
        console.error('Status poll error:', data.error)
        return
      }

      setJobStatus(data.status)

      if (data.status === 'completed') {
        setSubmitState('completed')
        // Redirect to dashboard after a short delay
        setTimeout(() => {
          router.push('/dashboard')
        }, 2000)
      } else if (data.status === 'failed') {
        setSubmitState('error')
        setSubmitError(data.errorMessage || 'Processing failed')
      }
    } catch (err) {
      console.error('Status poll exception:', err)
    }
  }, [router])

  // Set up polling when in processing state
  useEffect(() => {
    if (submitState !== 'processing' || !jobId) return

    const interval = setInterval(() => {
      pollStatus(jobId)
    }, 2000)

    // Initial poll
    pollStatus(jobId)

    return () => clearInterval(interval)
  }, [submitState, jobId, pollStatus])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)

    if (!recordedBlob) {
      setSubmitError('Please record a voice sample')
      return
    }

    if (recordingSeconds < MIN_RECORDING_SECONDS) {
      setSubmitError(`Please record for at least ${MIN_RECORDING_SECONDS} seconds`)
      return
    }

    try {
      // Step 1: Get signed upload URL
      setSubmitState('uploading')
      const uploadUrlRes = await fetch('/api/storage/upload-url', { method: 'POST' })
      const uploadUrlData: UploadUrlResponse = await uploadUrlRes.json()

      if (!uploadUrlData.success) {
        throw new Error(uploadUrlData.error)
      }

      // Step 2: Upload audio directly to Supabase Storage
      const uploadRes = await fetch(uploadUrlData.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': recordedBlob.type || 'audio/webm',
        },
        body: recordedBlob,
      })

      if (!uploadRes.ok) {
        throw new Error('Failed to upload audio file')
      }

      // Step 3: Enqueue the onboarding job (saves data to DB)
      setSubmitState('enqueuing')
      const enqueueRes = await fetch('/api/onboarding/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goals: '',
          fears: '',
          currentWork: '',
          audioStoragePath: uploadUrlData.storagePath,
        }),
      })

      const enqueueData: EnqueueResponse = await enqueueRes.json()

      if (!enqueueData.success) {
        throw new Error(enqueueData.error)
      }

      // Step 4: Start processing (create voice + agent)
      setJobId(enqueueData.jobId)
      setSubmitState('processing')
      setJobStatus('processing')

      // Extract the path without bucket prefix for the process endpoint
      const voiceSamplePath = uploadUrlData.storagePath.replace('voice-samples/', '')

      // Call process endpoint with timestampId from enqueue
      const processRes = await fetch('/api/onboarding/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceSamplePath,
          timestampId: enqueueData.timestampId,
          agentName: `PastSelf-${Date.now()}`,
          firstMessage: "Hey — it's you from the past. How's it going?",
        }),
      })

      const processData = await processRes.json()

      if (!processRes.ok || processData.error) {
        throw new Error(processData.error || 'Processing failed')
      }

      // Success!
      setJobStatus('completed')
      setSubmitState('completed')
      setTimeout(() => router.push('/dashboard'), 2000)

    } catch (err) {
      console.error('Submit error:', err)
      setSubmitState('error')
      setSubmitError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const hasAudio = !!recordedBlob
  const hasEnoughAudio = recordingSeconds >= MIN_RECORDING_SECONDS
  const isSubmitting = submitState !== 'idle' && submitState !== 'error'

  // Show processing screen
  if (submitState === 'processing' || submitState === 'completed') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-900">
        <div className="w-full max-w-md px-6 text-center">
          <Heading>Creating your past self...</Heading>
          <Text className="mt-2">
            This may take a minute. Please don&apos;t close this page.
          </Text>

          <div className="mt-8 space-y-4">
            <ProcessingStep
              label="Upload complete"
              status="completed"
            />
            <ProcessingStep
              label="Creating voice..."
              status={
                jobStatus === 'queued' ? 'pending' :
                jobStatus === 'processing' ? 'active' :
                'completed'
              }
            />
            <ProcessingStep
              label="Creating agent..."
              status={
                ['queued', 'processing', 'voice_created'].includes(jobStatus) ? 'pending' :
                jobStatus === 'agent_created' ? 'active' :
                jobStatus === 'completed' ? 'completed' :
                'pending'
              }
            />
            <ProcessingStep
              label="Ready!"
              status={jobStatus === 'completed' ? 'completed' : 'pending'}
            />
          </div>

          {submitState === 'completed' && (
            <Text className="mt-6 text-green-600 dark:text-green-400">
              Redirecting to dashboard...
            </Text>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-900">
      <div className="w-full max-w-xl px-6">
        <div className="text-center mb-10">
          <Heading>Answer these questions about yourself</Heading>
          <Text className="mt-3">
            Record yourself speaking about these topics for at least 30 seconds.
            This helps us create your personalized AI voice.
          </Text>
          <Text className="mt-2 text-sm text-indigo-600 dark:text-indigo-400">
            Tip: The longer you talk, the more accurate and fun it&apos;ll be!
          </Text>
        </div>

        {/* Questions as prompts with progress indicators */}
        <div className="mb-10 space-y-4">
          <CategoryPrompt
            title="What are your goals?"
            description="What are you hoping to achieve in the near future?"
            isCompleted={categoryProgress.goals}
            isRecording={isRecording}
          />
          <CategoryPrompt
            title="What are your fears?"
            description="What concerns or challenges are you facing?"
            isCompleted={categoryProgress.fears}
            isRecording={isRecording}
          />
          <CategoryPrompt
            title="What are you working on?"
            description="Describe your current projects or focus areas."
            isCompleted={categoryProgress.working_on}
            isRecording={isRecording}
          />
        </div>

        {submitError && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <Text className="text-red-600 dark:text-red-400">{submitError}</Text>
            <Button
              type="button"
              className="mt-2"
              onClick={() => {
                setSubmitState('idle')
                setSubmitError(null)
              }}
            >
              Try Again
            </Button>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Recording Section */}
          <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-800">
            <div className="flex flex-col items-center">
              {/* Timer Display */}
              <div className={`text-5xl font-light tabular-nums mb-6 ${
                isRecording
                  ? recordingSeconds >= MIN_RECORDING_SECONDS
                    ? 'text-green-500'
                    : 'text-red-500'
                  : hasAudio
                    ? hasEnoughAudio
                      ? 'text-green-500'
                      : 'text-amber-500'
                    : 'text-zinc-300 dark:text-zinc-600'
              }`}>
                {formatTime(recordingSeconds)}
              </div>

              {/* Progress indicator */}
              {(isRecording || hasAudio) && !hasEnoughAudio && (
                <Text className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                  {MIN_RECORDING_SECONDS - recordingSeconds} more seconds needed
                </Text>
              )}
              {hasEnoughAudio && !isRecording && (
                <Text className="text-sm text-green-600 dark:text-green-400 mb-4">
                  Great! You can submit or record more.
                </Text>
              )}

              {/* Recording Button */}
              {!hasAudio ? (
                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isSubmitting}
                  className={`w-24 h-24 rounded-full flex items-center justify-center transition-all ${
                    isRecording
                      ? 'bg-red-500 hover:bg-red-600 scale-110'
                      : 'bg-indigo-500 hover:bg-indigo-600'
                  } disabled:opacity-50`}
                >
                  {isRecording ? (
                    <IconPlayerStop size={40} className="text-white" />
                  ) : (
                    <IconMicrophone size={40} className="text-white" />
                  )}
                </button>
              ) : (
                <div className="w-full space-y-4">
                  {/* Audio Preview */}
                  <audio controls src={audioUrl!} className="w-full" />

                  <div className="flex justify-center gap-3">
                    <Button type="button" onClick={clearAudio} outline disabled={isSubmitting}>
                      <IconX size={18} data-slot="icon" />
                      Re-record
                    </Button>
                  </div>
                </div>
              )}

              {/* Recording status */}
              {isRecording && (
                <div className="flex items-center gap-2 mt-6 text-red-500">
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500"></span>
                  </span>
                  Recording...
                </div>
              )}

              {!isRecording && !hasAudio && (
                <Text className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
                  Tap to start recording
                </Text>
              )}
            </div>
          </div>

          {/* Transcript Box */}
          {(isRecording || transcript || partialTranscript) && (
            <div className="mt-4 rounded-xl bg-zinc-100 dark:bg-zinc-900 overflow-hidden border border-zinc-300 dark:border-zinc-700">
              <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Live Transcript (Powered by Scribe v2 Realtime)
                </span>
              </div>
              <div className="max-h-40 overflow-y-auto p-4">
                {(transcript || partialTranscript) ? (
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
                    {renderHighlightedTranscript()}
                    {partialTranscript && (
                      <span className="text-zinc-400 dark:text-zinc-500 italic">
                        {transcript ? ' ' : ''}{partialTranscript}
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="text-sm text-zinc-400 dark:text-zinc-500 italic">
                    Start speaking to see the transcript...
                  </p>
                )}
              </div>
              {/* Color Legend */}
              <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-t border-zinc-300 dark:border-zinc-700 text-xs bg-zinc-200/50 dark:bg-zinc-800/50">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-indigo-400 dark:bg-indigo-500"></span>
                  <span className="text-zinc-700 dark:text-zinc-300">Goals</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-amber-400 dark:bg-amber-500"></span>
                  <span className="text-zinc-700 dark:text-zinc-300">Fears</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-emerald-400 dark:bg-emerald-500"></span>
                  <span className="text-zinc-700 dark:text-zinc-300">Working On</span>
                </div>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <div className="mt-8">
            <Button
              type="submit"
              color="indigo"
              className="w-full"
              disabled={isSubmitting || !hasAudio || !hasEnoughAudio}
            >
              {isSubmitting ? (
                <>
                  <IconLoader2 size={20} className="animate-spin" data-slot="icon" />
                  {submitState === 'uploading' ? 'Uploading...' : 'Processing...'}
                </>
              ) : (
                'Create My Past Self'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Processing step component
function ProcessingStep({ label, status }: { label: string; status: 'pending' | 'active' | 'completed' }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
        status === 'completed' ? 'bg-green-500' :
        status === 'active' ? 'bg-indigo-500' :
        'bg-zinc-300 dark:bg-zinc-700'
      }`}>
        {status === 'completed' ? (
          <IconCheck size={18} className="text-white" />
        ) : status === 'active' ? (
          <IconLoader2 size={18} className="animate-spin text-white" />
        ) : (
          <div className="h-2 w-2 rounded-full bg-zinc-400 dark:bg-zinc-500" />
        )}
      </div>
      <span className={`text-sm ${
        status === 'completed' ? 'text-green-600 dark:text-green-400' :
        status === 'active' ? 'text-indigo-600 dark:text-indigo-400 font-medium' :
        'text-zinc-500 dark:text-zinc-400'
      }`}>
        {label}
      </span>
    </div>
  )
}

// Category prompt component with progress indicator
function CategoryPrompt({
  title,
  description,
  isCompleted,
  isRecording,
}: {
  title: string
  description: string
  isCompleted: boolean
  isRecording: boolean
}) {
  return (
    <div
      className={`rounded-xl p-5 shadow-sm transition-all duration-300 ${
        isCompleted
          ? 'bg-green-50 dark:bg-green-900/20 border-2 border-green-500/50'
          : 'bg-white dark:bg-zinc-800'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <Text className={`font-medium ${isCompleted ? 'text-green-700 dark:text-green-300' : 'text-zinc-900 dark:text-white'}`}>
            {title}
          </Text>
          <Text className={`mt-1 text-sm ${isCompleted ? 'text-green-600 dark:text-green-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
            {description}
          </Text>
        </div>
        <div className="flex-shrink-0 mt-1">
          {isCompleted ? (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500">
              <IconCheck size={14} className="text-white" />
            </div>
          ) : isRecording ? (
            <div className="flex h-6 w-6 items-center justify-center">
              <IconLoader2 size={18} className="animate-spin text-zinc-400" />
            </div>
          ) : (
            <div className="h-6 w-6 rounded-full border-2 border-zinc-300 dark:border-zinc-600" />
          )}
        </div>
      </div>
    </div>
  )
}
