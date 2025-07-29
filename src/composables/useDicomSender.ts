import { ref, computed } from 'vue'
import { Effect, Layer } from 'effect'
import type { DicomStudy } from '@/types/dicom'
import { DicomSender, DicomSenderLive, type DicomServerConfig, type SendingProgress } from '@/services/dicomSender'
import { ConfigServiceLive } from '@/services/config'

const senderLayer = Layer.mergeAll(
  DicomSenderLive,
  ConfigServiceLive
)

const run = <A>(effect: Effect.Effect<A, any, any>) =>
  // @ts-ignore – Suppress typing noise when env is eliminated
  Effect.runPromise(effect.pipe(Effect.provide(senderLayer)))

export function useDicomSender() {
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const progress = ref<SendingProgress | null>(null)
  const connectionStatus = ref<boolean | null>(null)

  const sendStudy = async (
    study: DicomStudy,
    options: { concurrency?: number; maxRetries?: number } = {}
  ): Promise<boolean> => {
    loading.value = true
    error.value = null
    try {
      await run(
        Effect.gen(function* () {
          const sender = yield* DicomSender
          return yield* sender.sendStudy(study, options)
        })
      )
      return true
    } catch (e) {
      error.value = e as Error
      return false
    } finally {
      loading.value = false
    }
  }

  const sendStudyWithProgress = async (
    study: DicomStudy,
    options: { concurrency?: number; maxRetries?: number } = {}
  ): Promise<boolean> => {
    loading.value = true
    error.value = null
    progress.value = null
    try {
      await run(
        Effect.gen(function* () {
          const sender = yield* DicomSender
          return yield* sender.sendStudy(study, {
            ...options,
            onProgress: (p) => {
              progress.value = p
            }
          })
        })
      )
      return true
    } catch (e) {
      error.value = e as Error
      return false
    } finally {
      loading.value = false
    }
  }

  const testConnection = async (): Promise<boolean> => {
    try {
      const isConnected = await run(
        Effect.gen(function* () {
          const sender = yield* DicomSender
          return yield* sender.testConnection
        })
      )
      connectionStatus.value = isConnected
      return isConnected
    } catch (e) {
      error.value = e as Error
      connectionStatus.value = false
      return false
    }
  }

  const updateServerConfig = (newConfig: DicomServerConfig) => {
    run(
      Effect.gen(function* () {
        const sender = yield* DicomSender
        return yield* sender.updateConfig(newConfig)
      })
    ).catch((e) => {
      error.value = e as Error
    })
  }

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
    loading,
    error,
    progress,
    connectionStatus,
    isConnected,
    progressPercentage,
    sendStudy,
    sendStudyWithProgress,
    testConnection,
    updateServerConfig,
    reset
  }
}
