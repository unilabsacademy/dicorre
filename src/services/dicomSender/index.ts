import { Effect, Context, Layer } from "effect"
import { api } from 'dicomweb-client'
const { DICOMwebClient } = api
import type { DicomFile, DicomStudy } from '@/types/dicom'
import { NetworkError, ValidationError, type DicomSenderError } from '@/types/effects'
import { ConfigService } from '../config'
import { getSendingWorkerManager, type SendingJob } from '../../workers/workerManager'
import { getTransmissionTracker } from './transmissionTracker'

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

export interface SendingProgress {
  total: number
  completed: number
  percentage: number
  currentFile?: string
}

export class DicomSender extends Context.Tag("DicomSender")<
  DicomSender,
  {
    readonly testConnection: Effect.Effect<boolean, DicomSenderError>
    readonly sendFile: (file: DicomFile) => Effect.Effect<void, DicomSenderError>
    readonly sendStudy: (study: DicomStudy, options?: { concurrency?: number; maxRetries?: number; onProgress?: (progress: SendingProgress) => void }) => Effect.Effect<DicomFile[], DicomSenderError>
    readonly updateConfig: (config: DicomServerConfig) => Effect.Effect<void, ValidationError>
    readonly getConfig: Effect.Effect<DicomServerConfig, never>
    readonly getTransmissionState: (studyId: string) => Effect.Effect<any, never>
    readonly getAllTransmissionStates: Effect.Effect<any[], never>
    readonly isTransmitting: (studyId: string) => Effect.Effect<boolean, never>
  }
>() {}

/**
 * Internal implementation class
 */
class DicomSenderImpl {
  private static config: DicomServerConfig | null = null

  /**
   * Initialize with config from ConfigService
   */
  private static initConfig(): Effect.Effect<void, DicomSenderError, ConfigService> {
    return Effect.gen(function* () {
      const configService = yield* ConfigService
      DicomSenderImpl.config = yield* configService.getServerConfig
    })
  }

  /**
   * Get current config or initialize from ConfigService
   */
  private static getConfigInternal(): Effect.Effect<DicomServerConfig, DicomSenderError, ConfigService> {
    return Effect.gen(function* () {
      if (!DicomSenderImpl.config) {
        yield* DicomSenderImpl.initConfig()
      }
      return DicomSenderImpl.config!
    })
  }

  /**
   * Effect-based connection testing
   */
  static testConnection: Effect.Effect<boolean, DicomSenderError, ConfigService> = Effect.gen(function* () {
    const config = yield* DicomSenderImpl.getConfigInternal()

    const result = yield* Effect.tryPromise({
      try: async () => {
        const testUrl = `${config.url}/studies?limit=1`
        const response = await fetch(testUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json', ...config.headers }
        })
        return response.ok
      },
      catch: (error) => new NetworkError({
        message: `Failed to connect to DICOM server: ${config.url}`,
        serverUrl: config.url,
        cause: error
      })
    })

    return result
  })

  /**
   * Effect-based file sending
   */
  static sendFile = (file: DicomFile): Effect.Effect<void, DicomSenderError, ConfigService> =>
    Effect.gen(function* () {
      const config = yield* DicomSenderImpl.getConfigInternal()

      // Validate file
      if (!file.arrayBuffer || file.arrayBuffer.byteLength === 0) {
        return yield* Effect.fail(new ValidationError({
          message: `File ${file.fileName} has no data`,
          fileName: file.fileName
        }))
      }

      if (!file.metadata?.sopInstanceUID) {
        return yield* Effect.fail(new ValidationError({
          message: `File ${file.fileName} has no SOP Instance UID`,
          fileName: file.fileName
        }))
      }

      yield* Effect.tryPromise({
        try: async () => {
          console.log(`Sending DICOM file: ${file.fileName}`)
          
          // Prepare headers with auth if provided
          const headers: Record<string, string> = {
            'Accept': 'multipart/related; type="application/dicom"',
            ...config.headers
          }

          // Add authentication headers if configured
          if (config.auth) {
            if (config.auth.type === 'basic') {
              headers['Authorization'] = `Basic ${config.auth.credentials}`
            } else if (config.auth.type === 'bearer') {
              headers['Authorization'] = `Bearer ${config.auth.credentials}`
            }
          }

          const client = new DICOMwebClient({
            url: config.url,
            singlepart: false,
            headers
          })

          // Convert ArrayBuffer to Uint8Array for dicomweb-client
          const uint8Array = new Uint8Array(file.arrayBuffer)
          
          // Store instance using DICOM web STOW-RS
          await client.storeInstances({
            datasets: [uint8Array]
          })

          console.log(`Successfully sent ${file.fileName} to DICOM server`)
        },
        catch: (error) => new NetworkError({
          message: `Failed to send file ${file.fileName} to DICOM server`,
          serverUrl: config.url,
          fileName: file.fileName,
          cause: error
        })
      })
    })

  /**
   * Send study with progress tracking and error handling using worker pool
   */
  static sendStudy = (
    study: DicomStudy,
    options: { concurrency?: number; maxRetries?: number; onProgress?: (progress: SendingProgress) => void } = {}
  ): Effect.Effect<DicomFile[], DicomSenderError, ConfigService> =>
    Effect.gen(function* () {
      const { concurrency = 2, onProgress } = options
      const config = yield* DicomSenderImpl.getConfigInternal()

      // Collect all files from the study
      const allFiles: DicomFile[] = []
      for (const series of study.series) {
        allFiles.push(...series.files)
      }

      if (allFiles.length === 0) {
        console.log(`Study ${study.studyInstanceUID} has no files to send`)
        return []
      }

      console.log(`Sending study ${study.studyInstanceUID} with ${allFiles.length} files using worker pool`)

      // Get transmission tracker
      const transmissionTracker = getTransmissionTracker()
      
      // Start tracking transmission
      transmissionTracker.startTransmission(study.studyInstanceUID, allFiles.length)

      // Convert to worker-compatible format
      const workerManager = getSendingWorkerManager()
      
      // Create a promise that will be resolved when the worker completes
      const sendingPromise = new Promise<DicomFile[]>((resolve, reject) => {
        const sendingJob: SendingJob = {
          studyId: study.studyInstanceUID,
          files: allFiles,
          serverConfig: {
            url: config.url,
            headers: config.headers,
            auth: config.auth
          },
          concurrency,
          onProgress: onProgress ? (progress) => {
            // Update transmission tracker
            transmissionTracker.updateProgress(study.studyInstanceUID, {
              studyId: study.studyInstanceUID,
              total: progress.total,
              completed: progress.completed,
              percentage: progress.percentage,
              currentFile: progress.currentFile
            })
            
            // Convert worker progress format to DicomSender progress format
            onProgress({
              total: progress.total,
              completed: progress.completed,
              percentage: progress.percentage,
              currentFile: progress.currentFile
            })
          } : (progress) => {
            // Always update transmission tracker even if no onProgress callback
            transmissionTracker.updateProgress(study.studyInstanceUID, {
              studyId: study.studyInstanceUID,
              total: progress.total,
              completed: progress.completed,
              percentage: progress.percentage,
              currentFile: progress.currentFile
            })
          },
          onComplete: (sentFiles) => {
            console.log(`Successfully sent study ${study.studyInstanceUID} via workers`)
            // Mark transmission as completed
            transmissionTracker.completeTransmission(study.studyInstanceUID)
            resolve(sentFiles)
          },
          onError: (error) => {
            console.error(`Failed to send study ${study.studyInstanceUID} via workers:`, error)
            // Mark transmission as failed
            transmissionTracker.failTransmission(study.studyInstanceUID, error.message)
            reject(new NetworkError({
              message: `Failed to send study via workers: ${error.message}`,
              serverUrl: config.url,
              cause: error
            }))
          }
        }

        // Queue the job with the worker manager
        workerManager.sendStudy(sendingJob)
      })

      // Convert promise to Effect
      const result = yield* Effect.tryPromise({
        try: () => sendingPromise,
        catch: (error) => {
          if (error instanceof NetworkError) {
            return error
          }
          return new NetworkError({
            message: `Failed to send study ${study.studyInstanceUID}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            serverUrl: config.url,
            cause: error
          })
        }
      })

      return result
    })

  /**
   * Update configuration
   */
  static updateConfig = (config: DicomServerConfig): Effect.Effect<void, ValidationError> =>
    Effect.gen(function* () {
      // Validate config
      if (!config.url || config.url.trim() === '') {
        return yield* Effect.fail(new ValidationError({
          message: 'DICOM server URL cannot be empty',
          fileName: 'config'
        }))
      }

      // Validate URL format
      try {
        new URL(config.url)
      } catch (error) {
        return yield* Effect.fail(new ValidationError({
          message: `Invalid DICOM server URL: ${config.url}`,
          fileName: 'config',
          cause: error
        }))
      }

      DicomSenderImpl.config = { ...config }
    })

  /**
   * Get current configuration
   */
  static getConfig: Effect.Effect<DicomServerConfig, never> = Effect.succeed(DicomSenderImpl.config || {
    url: '',
    description: 'Default DICOM Server'
  })

  /**
   * Get transmission state for a study
   */
  static getTransmissionState = (studyId: string) => Effect.succeed(
    getTransmissionTracker().getState(studyId)
  )

  /**
   * Get all transmission states
   */
  static getAllTransmissionStates = Effect.succeed(
    getTransmissionTracker().getAllStates()
  )

  /**
   * Check if a study is currently being transmitted
   */
  static isTransmitting = (studyId: string) => Effect.succeed(
    getTransmissionTracker().isTransmitting(studyId)
  )
}

/**
 * Live implementation layer with ConfigService dependency
 */
export const DicomSenderLive = Layer.succeed(
  DicomSender,
  DicomSender.of({
    testConnection: DicomSenderImpl.testConnection,
    sendFile: DicomSenderImpl.sendFile,
    sendStudy: DicomSenderImpl.sendStudy,
    updateConfig: DicomSenderImpl.updateConfig,
    getConfig: DicomSenderImpl.getConfig,
    getTransmissionState: DicomSenderImpl.getTransmissionState,
    getAllTransmissionStates: DicomSenderImpl.getAllTransmissionStates,
    isTransmitting: DicomSenderImpl.isTransmitting
  })
)