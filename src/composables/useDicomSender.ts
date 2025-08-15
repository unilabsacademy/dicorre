import { ref, computed } from 'vue'
import { Stream } from 'effect'
import type { DicomFile, DicomStudy } from '@/types/dicom'
import type { SendingEvent } from '@/types/events'
import { getSendingWorkerManager } from '@/workers/workerManager'

export interface SendingProgress {
  total: number
  completed: number
  percentage: number
  currentFile?: string
}

export interface DicomServerConfig {
  url: string
  headers?: Record<string, string>
  timeout?: number
  auth?: {
    type: 'basic' | 'bearer'
    credentials: string
  } | null
  description?: string
}

export function useDicomSender() {
  // UI state management with Vue refs
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const progress = ref<SendingProgress | null>(null)

  const sendStudyStream = (
    studyId: string,
    files: DicomFile[],
    serverConfig: DicomServerConfig,
    concurrency: number
  ): Stream.Stream<SendingEvent, Error> =>
    Stream.async<SendingEvent, Error>((emit) => {
      const workerManager = getSendingWorkerManager()
      workerManager.sendStudy({
        studyId,
        files,
        serverConfig,
        concurrency,
        onProgress: (progressData) => {
          emit.single({
            _tag: "SendingProgress",
            studyId,
            completed: progressData.completed,
            total: progressData.total,
            currentFile: progressData.currentFile
          })
        },
        onComplete: (sentFiles) => {
          emit.single({
            _tag: "StudySent",
            studyId,
            files: sentFiles
          })
          emit.end()
        },
        onError: (err) => {
          emit.single({
            _tag: "SendingError",
            studyId,
            error: err
          })
          emit.fail(err)
        }
      })

      // Emit start event immediately
      emit.single({
        _tag: "SendingStarted",
        studyId,
        totalFiles: files.length
      })
    })

  const reset = () => {
    loading.value = false
    error.value = null
    progress.value = null
  }

  const progressPercentage = computed(() => progress.value?.percentage || 0)

  return {
    // UI state
    loading,
    error,
    progress,
    progressPercentage,
    // Stream-based sending
    sendStudyStream,
    reset
  }
}
