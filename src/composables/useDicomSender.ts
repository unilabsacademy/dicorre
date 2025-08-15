import { ref, computed } from 'vue'
import { Stream, Effect } from 'effect'
import type { DicomFile, DicomStudy } from '@/types/dicom'
import type { SendingEvent } from '@/types/events'
import { getSendingWorkerManager } from '@/workers/workerManager'
import type { SendingJob } from '@/workers/workerManager'
import { ConfigService } from '@/services/config'
import { ManagedRuntime, Layer } from 'effect'
import { ConfigServiceLive } from '@/services/config'
import { clearStudyCache } from '@/services/anonymizer/handlers'

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

interface StudySendingProgress {
  isProcessing: boolean
  progress: number
  totalFiles: number
  currentFile?: string
}

export interface SendingEffectOptions {
  concurrency: number
  dicomFiles: DicomFile[]
  onUpdateFiles: (files: DicomFile[]) => void
  onUpdateStudies: (studies: DicomStudy[]) => void
  onSetSendingProgress: (studyId: string, progress: StudySendingProgress) => void
  onRemoveSendingProgress: (studyId: string) => void
  onSuccessMessage: (message: string) => void
}

type RuntimeType = ReturnType<typeof ManagedRuntime.make<any, any>>

export function useDicomSender(runtime?: RuntimeType) {
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

  const testConnection = (): Effect.Effect<void, Error, ConfigService> =>
    Effect.gen(function* () {
      if (!runtime) {
        return yield* Effect.fail(new Error('Runtime not provided to useDicomSender'))
      }

      // Get server config from the shared configuration service
      const configService = yield* ConfigService
      const serverConfig = yield* configService.getServerConfig
      
      // Test connection to the server (use relative URL for proxying)
      const testUrl = `${serverConfig.url}/studies`
        
      const response = yield* Effect.tryPromise({
        try: async () => {
          const result = await fetch(testUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/dicom+json', ...serverConfig.headers }
          })
          return result.ok
        },
        catch: (error) => new Error(`Failed to connect to DICOM server: ${testUrl} - ${error}`)
      })

      if (!response) {
        return yield* Effect.fail(new Error(`DICOM server test failed: ${testUrl}`))
      }

      return yield* Effect.succeed(undefined)
    })

  const handleSendSelectedEffect = (
    selectedStudies: DicomStudy[],
    options: SendingEffectOptions
  ): Effect.Effect<void, Error, ConfigService> =>
    Effect.gen(function* () {
      if (!runtime) {
        return yield* Effect.fail(new Error('Runtime not provided to useDicomSender'))
      }

      if (selectedStudies.length === 0) {
        return yield* Effect.succeed(undefined)
      }

      // Get server config from the shared configuration service
      const configService = yield* ConfigService
      const serverConfigFromService = yield* configService.getServerConfig
      
      // Use the URL as-is from the service (it should be relative for proxying)
      const serverConfig: DicomServerConfig = {
        url: serverConfigFromService.url,
        headers: {
          'Accept': 'application/dicom+json',
          'Content-Type': 'application/dicom',
          ...serverConfigFromService.headers
        },
        timeout: serverConfigFromService.timeout,
        auth: serverConfigFromService.auth,
        description: serverConfigFromService.description
      }

      const workerManager = getSendingWorkerManager()

      // Send each study
      for (const study of selectedStudies) {
        // Get files for this study that are anonymized
        const studyFiles = options.dicomFiles.filter(file => 
          file.metadata?.studyInstanceUID === study.studyInstanceUID && 
          file.anonymized
        )

        if (studyFiles.length === 0) {
          continue
        }

        // Create sending job
        const sendingJob: SendingJob = {
          studyId: study.studyInstanceUID,
          files: studyFiles,
          serverConfig,
          concurrency: options.concurrency,
          onProgress: (progressData) => {
            options.onSetSendingProgress(study.studyInstanceUID, {
              isProcessing: true,
              progress: progressData.percentage,
              totalFiles: progressData.total,
              currentFile: progressData.currentFile
            })
          },
          onComplete: (sentFiles) => {
            // Update files with sent status
            const updatedFiles = options.dicomFiles.map(file => {
              const sentFile = sentFiles.find(sf => sf.id === file.id)
              if (sentFile) {
                return { ...file, sent: true }
              }
              return file
            })
            options.onUpdateFiles(updatedFiles)

            // Clear the anonymization cache for this study to prevent UID conflicts
            clearStudyCache(study.studyInstanceUID)

            // Update studies with sent status
            const updatedStudies = [study] // For now, we'll let the parent handle study updates
            
            options.onRemoveSendingProgress(study.studyInstanceUID)
            options.onSuccessMessage(`Successfully sent ${sentFiles.length} files from study ${study.studyInstanceUID}`)
          },
          onError: (error) => {
            options.onRemoveSendingProgress(study.studyInstanceUID)
            throw error
          }
        }

        // Queue the job for processing
        workerManager.sendStudy(sendingJob)
      }

      return yield* Effect.succeed(undefined)
    })

  const progressPercentage = computed(() => progress.value?.percentage || 0)

  return {
    // UI state
    loading,
    error,
    progress,
    progressPercentage,
    // Stream-based sending
    sendStudyStream,
    // Effect-based methods
    handleSendSelectedEffect,
    testConnection,
    reset
  }
}
