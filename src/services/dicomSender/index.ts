import { Effect, Context, Layer } from "effect"
import { api } from 'dicomweb-client'
const { DICOMwebClient } = api
import type { DicomFile, DicomStudy } from '@/types/dicom'
import { NetworkError, ValidationError, type DicomSenderError } from '@/types/effects'
import { ConfigService } from '../config'

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
   * Send study with progress tracking and error handling
   */
  static sendStudy = (
    study: DicomStudy,
    options: { concurrency?: number; maxRetries?: number; onProgress?: (progress: SendingProgress) => void } = {}
  ): Effect.Effect<DicomFile[], DicomSenderError, ConfigService> =>
    Effect.gen(function* () {
      const { concurrency = 2, maxRetries = 3, onProgress } = options

      // Collect all files from the study
      const allFiles: DicomFile[] = []
      for (const series of study.series) {
        allFiles.push(...series.files)
      }

      if (allFiles.length === 0) {
        console.log(`Study ${study.studyInstanceUID} has no files to send`)
        return []
      }

      let completed = 0
      const total = allFiles.length

      console.log(`Sending study ${study.studyInstanceUID} with ${total} files`)

      // Create sending effects with progress tracking
      const sendingEffects = allFiles.map((file) =>
        Effect.gen(function* () {
          if (onProgress) {
            onProgress({
              total,
              completed,
              percentage: Math.round((completed / total) * 100),
              currentFile: file.fileName
            })
          }

          // Add retry logic
          const sendWithRetry = Effect.retry(
            DicomSenderImpl.sendFile(file),
            {
              times: maxRetries,
              schedule: Effect.Schedule.exponential('100 millis')
            }
          )

          yield* sendWithRetry
          
          completed++
          if (onProgress) {
            onProgress({
              total,
              completed,
              percentage: Math.round((completed / total) * 100),
              currentFile: file.fileName
            })
          }

          return file
        })
      )

      // Execute all sending operations concurrently
      const results = yield* Effect.all(sendingEffects, { concurrency, batching: true })

      console.log(`Successfully sent ${results.length}/${total} files for study ${study.studyInstanceUID}`)
      return results
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
    getConfig: DicomSenderImpl.getConfig
  })
)