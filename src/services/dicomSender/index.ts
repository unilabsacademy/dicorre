import { Effect, Context, Layer } from "effect"
import { api } from 'dicomweb-client'
const { DICOMwebClient } = api
import type { DicomFile } from '@/types/dicom'
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


export class DicomSender extends Context.Tag("DicomSender")<
  DicomSender,
  {
    readonly testConnection: Effect.Effect<boolean, DicomSenderError>
    readonly sendFile: (file: DicomFile) => Effect.Effect<void, DicomSenderError>
    readonly updateConfig: (config: DicomServerConfig) => Effect.Effect<void, ValidationError>
    readonly getConfig: Effect.Effect<DicomServerConfig, never>
  }
>() { }

/**
 * Internal implementation class
 */
class DicomSenderImpl {
  private static config: DicomServerConfig | null = null

  private static initConfig(): Effect.Effect<void, DicomSenderError, ConfigService> {
    return Effect.gen(function* () {
      const configService = yield* ConfigService
      DicomSenderImpl.config = yield* configService.getServerConfig
    })
  }

  private static getConfigInternal(): Effect.Effect<DicomServerConfig, DicomSenderError, ConfigService> {
    return Effect.gen(function* () {
      if (!DicomSenderImpl.config) {
        yield* DicomSenderImpl.initConfig()
      }
      return DicomSenderImpl.config!
    })
  }

  static testConnection: Effect.Effect<boolean, DicomSenderError, ConfigService> = Effect.gen(function* () {
    const config = yield* DicomSenderImpl.getConfigInternal()

    const result = yield* Effect.tryPromise({
      try: async () => {
        const testUrl = `${config.url}/studies`
        const response = await fetch(testUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/dicom+json', ...config.headers }
        })
        return response.ok
      },
      catch: (error) => new NetworkError({
        message: `Failed to connect to DICOM server: ${config.url}`,
        cause: error
      })
    })

    return result
  })

  static sendFile = (file: DicomFile): Effect.Effect<void, DicomSenderError, ConfigService> =>
    Effect.gen(function* () {
      const config = yield* DicomSenderImpl.getConfigInternal()

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
          message: `Failed to send file ${file.fileName} to DICOM server - ${config.url}`,
          cause: error
        })
      })
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
export const DicomSenderLive = Layer.effect(
  DicomSender,
  Effect.gen(function* () {
    return DicomSender.of({
      testConnection: DicomSenderImpl.testConnection,
      sendFile: DicomSenderImpl.sendFile,
      updateConfig: DicomSenderImpl.updateConfig,
      getConfig: DicomSenderImpl.getConfig
    })
  })
)
