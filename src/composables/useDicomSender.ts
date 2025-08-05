import { ref, computed } from 'vue'
import { Effect } from 'effect'
import type { DicomStudy } from '@/types/dicom'
import { DicomSender, type DicomServerConfig, type SendingProgress } from '@/services/dicomSender'

export function useDicomSender() {
  // UI state management with Vue refs
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const progress = ref<SendingProgress | null>(null)
  const connectionStatus = ref<boolean | null>(null)

  // Effect program for sending study
  const sendStudy = (
    study: DicomStudy,
    options: { concurrency?: number; maxRetries?: number } = {}
  ) =>
    Effect.gen(function* () {
      const sender = yield* DicomSender
      return yield* sender.sendStudy(study, options)
    })

  // Effect program for sending study with progress tracking
  const sendStudyWithProgress = (
    study: DicomStudy,
    options: { concurrency?: number; maxRetries?: number; onProgress?: (progress: SendingProgress) => void } = {}
  ) =>
    Effect.gen(function* () {
      const sender = yield* DicomSender
      return yield* sender.sendStudy(study, {
        ...options,
        onProgress: (p) => {
          progress.value = p
          // Also call the external callback if provided
          if (options.onProgress) {
            options.onProgress(p)
          }
        }
      })
    })

  // Effect program for testing connection
  const testConnection = () =>
    Effect.gen(function* () {
      const sender = yield* DicomSender
      const isConnected = yield* sender.testConnection
      connectionStatus.value = isConnected
      return isConnected
    })

  // Effect program for updating server configuration
  const updateServerConfig = (newConfig: DicomServerConfig) =>
    Effect.gen(function* () {
      const sender = yield* DicomSender
      return yield* sender.updateConfig(newConfig)
    })

  const reset = () => {
    loading.value = false
    error.value = null
    progress.value = null
  }

  const isConnected = computed(() => connectionStatus.value === true)
  const progressPercentage = computed(() => {
    if (!progress.value) return 0
    return Math.round((progress.value.completed / progress.value.total) * 100)
  })

  return {
    // UI state
    loading,
    error,
    progress,
    connectionStatus,
    isConnected,
    progressPercentage,
    // Effect programs
    sendStudy,
    sendStudyWithProgress,
    testConnection,
    updateServerConfig,
    reset
  }
}
