import { ref, shallowRef, computed } from 'vue'
import { Effect, Fiber } from 'effect'
import type { DicomFile } from '@/types/dicom'
import { ConfigService } from '@/services/config'
import type { DicomServerConfig } from '@/services/config/schema'
import type { RuntimeType } from '@/types/effects'
import { DicomSender } from '@/services/dicomSender'
import { OPFSStorage } from '@/services/opfsStorage'

export interface SendingProgress {
  total: number
  completed: number
  percentage: number
  currentFile?: string
}

export function useDicomSender(runtime?: RuntimeType) {
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const progress = ref<SendingProgress | null>(null)

  const fibers = shallowRef<Map<string, Fiber.RuntimeFiber<DicomFile[], Error>>>(new Map())
  const progresses = shallowRef<Map<string, SendingProgress>>(new Map())

  const setProgress = (studyId: string, patch: Partial<SendingProgress>) => {
    const prev = progresses.value.get(studyId) ?? { total: 0, completed: 0, percentage: 0 }
    const next = { ...prev, ...patch }
    progresses.value.set(studyId, next)
    progresses.value = new Map(progresses.value)
  }

  const clearProgress = (studyId: string) => {
    progresses.value.delete(studyId)
    progresses.value = new Map(progresses.value)
  }

  const normalizeServerConfig = (cfg: DicomServerConfig): DicomServerConfig => ({
    url: cfg.url,
    headers: cfg.headers,
    timeout: cfg.timeout,
    auth: cfg.auth,
    description: cfg.description
  })

  const sendStudyEffect = (
    studyId: string,
    files: DicomFile[],
    concurrency: number,
    options?: { onProgress?: (completed: number, total: number, currentFile?: DicomFile) => void }
  ): Effect.Effect<DicomFile[], Error, ConfigService | DicomSender | OPFSStorage> =>
    Effect.gen(function* () {
      if (!runtime) {
        return yield* Effect.fail(new Error('Runtime not provided to useDicomSender'))
      }
      if (files.length === 0) {
        return []
      }

      loading.value = true
      error.value = null
      setProgress(studyId, { total: files.length, completed: 0, percentage: 0, currentFile: undefined })

      const configService = yield* ConfigService
      const sender = yield* DicomSender
      const opfs = yield* OPFSStorage
      const serverConfig = normalizeServerConfig(yield* configService.getServerConfig)

      let completed = 0
      const total = files.length

      const sendEffects = files.map((file) =>
        Effect.gen(function* () {
          let toSend = file
          if (!toSend.arrayBuffer || toSend.arrayBuffer.byteLength === 0) {
            const loaded = yield* opfs.loadFile(toSend.id)
            toSend = { ...toSend, arrayBuffer: loaded }
          }
          yield* sender.sendFile(toSend, serverConfig)
          completed++
          setProgress(studyId, {
            total,
            completed,
            percentage: Math.round((completed / total) * 100),
            currentFile: file.fileName
          })
          options?.onProgress?.(completed, total, file)
          return toSend
        })
      )

      const sent = yield* Effect.all(sendEffects, { concurrency, batching: true })

      loading.value = false
      clearProgress(studyId)
      return sent
    }).pipe(
      Effect.catchAll((e) =>
        Effect.sync(() => {
          loading.value = false
          error.value = e instanceof Error ? e : new Error(String(e))
          clearProgress(studyId)
          throw error.value
        })
      ),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          loading.value = false
          error.value = new Error('Sending was cancelled')
          clearProgress(studyId)
        })
      )
    )

  const sendStudy = (
    studyId: string,
    files: DicomFile[],
    concurrency: number,
    options?: { onProgress?: (completed: number, total: number, currentFile?: DicomFile) => void }
  ): Promise<DicomFile[]> => {
    if (!runtime) throw new Error('Runtime not provided to useDicomSender')
    const effect = sendStudyEffect(studyId, files, concurrency, options)
    const fiber = runtime.runFork(effect)
    fibers.value.set(studyId, fiber)
    fibers.value = new Map(fibers.value)
    return runtime
      .runPromise(
        Fiber.join(fiber).pipe(
          Effect.catchAll(() => Effect.succeed<DicomFile[]>([]))
        )
      )
      .finally(() => {
        fibers.value.delete(studyId)
        fibers.value = new Map(fibers.value)
      })
  }

  const cancelStudy = (studyId: string) => {
    const fiber = fibers.value.get(studyId)
    if (!fiber) return
    Effect.runSync(Fiber.interrupt(fiber))
  }

  const cancelAll = () => {
    for (const [, fiber] of fibers.value.entries()) {
      Effect.runSync(Fiber.interrupt(fiber))
    }
  }

  const reset = () => {
    loading.value = false
    error.value = null
    progress.value = null
    progresses.value = new Map()
  }

  const testConnection = (): Effect.Effect<void, Error, ConfigService | DicomSender> =>
    Effect.gen(function* () {
      if (!runtime) {
        return yield* Effect.fail(new Error('Runtime not provided to useDicomSender'))
      }
      const configService = yield* ConfigService
      const sender = yield* DicomSender
      const serverConfig = yield* configService.getServerConfig
      const ok = yield* sender.testConnection(serverConfig)
      if (!ok) {
        return yield* Effect.fail(new Error(`DICOM server test failed: ${serverConfig.url}/studies`))
      }
      return undefined
    })

  const progressPercentage = computed(() => progress.value?.percentage || 0)
  const getStudyProgress = (studyId: string) => computed(() => progresses.value.get(studyId))
  const isStudySending = (studyId: string) => Boolean(fibers.value.get(studyId))
  const hasActiveSending = computed(() => fibers.value.size > 0)

  return {
    // UI state
    loading,
    error,
    progress,
    progressPercentage,

    // Progress accessors
    getStudyProgress,
    isStudySending,
    hasActiveSending,

    // Operations
    sendStudyEffect,
    sendStudy,
    cancelStudy,
    cancelAll,
    testConnection,
    reset
  }
}
