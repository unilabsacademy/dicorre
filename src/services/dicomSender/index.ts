import { Effect, Context, Layer } from "effect"
import type { DicomFile } from '@/types/dicom'
import type { DicomServerConfig } from '@/services/config/schema'
import { NetworkError, ValidationError, type DicomSenderError } from '@/types/effects'
import { ConfigService } from '../config'


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
 * Live implementation layer with ConfigService dependency
 */
export const DicomSenderLive = Layer.effect(
  DicomSender,
  Effect.gen(function* () {
    const configService = yield* ConfigService
    let config: DicomServerConfig | null = null

    const initConfig = (): Effect.Effect<void, DicomSenderError> =>
      Effect.gen(function* () {
        config = yield* configService.getServerConfig
      })

    const getConfigInternal = (): Effect.Effect<DicomServerConfig, DicomSenderError> =>
      Effect.gen(function* () {
        if (!config) {
          yield* initConfig()
        }
        return config!
      })

    const testConnection: Effect.Effect<boolean, DicomSenderError> = Effect.gen(function* () {
      const currentConfig = yield* getConfigInternal()

      const result = yield* Effect.tryPromise({
        try: async () => {
          const testUrl = `${currentConfig.url}/studies`
          const response = await fetch(testUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/dicom+json', ...currentConfig.headers }
          })
          return response.ok
        },
        catch: (error) => new NetworkError({
          message: `Failed to connect to DICOM server: ${currentConfig.url}`,
          cause: error
        })
      })

      return result
    })

    const sendFile = (file: DicomFile): Effect.Effect<void, DicomSenderError> =>
      Effect.gen(function* () {
        const currentConfig = yield* getConfigInternal()

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
              'Accept': 'application/dicom+json',
              ...currentConfig.headers
            }

            // Add authentication headers if configured
            if (currentConfig.auth) {
              if (currentConfig.auth.type === 'basic') {
                headers['Authorization'] = `Basic ${currentConfig.auth.credentials}`
              } else if (currentConfig.auth.type === 'bearer') {
                headers['Authorization'] = `Bearer ${currentConfig.auth.credentials}`
              }
            }

            // Convert ArrayBuffer to Uint8Array
            const uint8Array = new Uint8Array(file.arrayBuffer)

            // Create proper multipart form data for STOW-RS
            const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(2)}`
            const contentType = `multipart/related; type="application/dicom"; boundary=${boundary}`

            // Build multipart body
            const textPart = [
              `--${boundary}`,
              'Content-Type: application/dicom',
              '',
              ''
            ].join('\r\n')

            const endBoundary = `\r\n--${boundary}--`

            // Create the full body with binary data
            const textPartBytes = new TextEncoder().encode(textPart)
            const endBoundaryBytes = new TextEncoder().encode(endBoundary)

            // Combine text part + DICOM data + end boundary
            const totalLength = textPartBytes.length + uint8Array.length + endBoundaryBytes.length
            const body = new Uint8Array(totalLength)

            let offset = 0
            body.set(textPartBytes, offset)
            offset += textPartBytes.length
            body.set(uint8Array, offset)
            offset += uint8Array.length
            body.set(endBoundaryBytes, offset)

            // Store instance using DICOM web STOW-RS
            const stowUrl = `${currentConfig.url}/studies`
            const response = await fetch(stowUrl, {
              method: 'POST',
              headers: {
                ...headers,
                'Content-Type': contentType
              },
              body: body
            })

            if (!response.ok) {
              const errorText = await response.text()
              throw new Error(`STOW-RS failed: ${response.status} ${response.statusText} - ${errorText}`)
            }

            console.log(`Successfully sent ${file.fileName} to DICOM server`)
          },
          catch: (error) => new NetworkError({
            message: `Failed to send file ${file.fileName} to DICOM server - ${currentConfig.url}`,
            cause: error
          })
        })
      })

    const updateConfig = (newConfig: DicomServerConfig): Effect.Effect<void, ValidationError> =>
      Effect.gen(function* () {
        // Validate config
        if (!newConfig.url || newConfig.url.trim() === '') {
          return yield* Effect.fail(new ValidationError({
            message: 'DICOM server URL cannot be empty',
            fileName: 'config'
          }))
        }

        // Validate URL format (allow relative URLs for browser proxying)
        if (newConfig.url.startsWith('http')) {
          try {
            new URL(newConfig.url)
          } catch {
            return yield* Effect.fail(new ValidationError({
              message: `Invalid DICOM server URL: ${newConfig.url}`,
              fileName: 'config'
            }))
          }
        } else if (!newConfig.url.startsWith('/')) {
          return yield* Effect.fail(new ValidationError({
            message: `DICOM server URL must be absolute (http/https) or relative starting with /: ${newConfig.url}`,
            fileName: 'config'
          }))
        }

        config = { ...newConfig }
      })

    const getConfig: Effect.Effect<DicomServerConfig, never> = Effect.succeed(config || {
      url: '',
      description: 'Default DICOM Server'
    })

    return {
      testConnection,
      sendFile,
      updateConfig,
      getConfig
    } as const
  })
)
