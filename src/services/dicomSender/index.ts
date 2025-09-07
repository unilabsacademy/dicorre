import { Effect, Context, Layer } from "effect"
import type { DicomFile } from '@/types/dicom'
import type { DicomServerConfig } from '@/services/config/schema'
import { NetworkError, ValidationError, type DicomSenderError, type StorageErrorType } from '@/types/effects'
import { OPFSStorage } from '@/services/opfsStorage'


export class DicomSender extends Context.Tag("DicomSender")<
  DicomSender,
  {
    readonly testConnection: (config: DicomServerConfig) => Effect.Effect<boolean, DicomSenderError>
    readonly sendFile: (file: DicomFile, config: DicomServerConfig) => Effect.Effect<void, DicomSenderError>
    readonly sendFiles: (
      files: DicomFile[],
      config: DicomServerConfig,
      concurrency?: number,
      options?: { onProgress?: (completed: number, total: number, currentFile?: DicomFile) => void }
    ) => Effect.Effect<DicomFile[], DicomSenderError | StorageErrorType, OPFSStorage | DicomSender>
  }
>() { }

/**
 * Live implementation layer - stateless, accepts config as parameter
 */
export const DicomSenderLive = Layer.succeed(
  DicomSender,
  {
    testConnection: (config: DicomServerConfig): Effect.Effect<boolean, DicomSenderError> =>
      Effect.gen(function* () {
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
      }),

    sendFile: (file: DicomFile, config: DicomServerConfig): Effect.Effect<void, DicomSenderError> =>
      Effect.gen(function* () {

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
            const stowUrl = `${config.url}/studies`
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
            message: `Failed to send file ${file.fileName} to DICOM server - ${config.url}`,
            cause: error
          })
        })
      }),

    sendFiles: (
      files: DicomFile[],
      config: DicomServerConfig,
      concurrency = 3,
      options?: { onProgress?: (completed: number, total: number, currentFile?: DicomFile) => void }
    ): Effect.Effect<DicomFile[], DicomSenderError | StorageErrorType, OPFSStorage | DicomSender> =>
      Effect.gen(function* () {
        if (files.length === 0) return []

        // Enforce anonymized-only at the sender layer as defense in depth
        const nonAnonymized = files.filter((f) => !f.anonymized)
        if (nonAnonymized.length > 0) {
          return yield* Effect.fail(new ValidationError({
            message: `Attempted to send ${nonAnonymized.length} non-anonymized file(s)`,
            fileName: nonAnonymized[0].fileName
          }))
        }

        const opfs = yield* OPFSStorage
        const sender = yield* DicomSender
        let completed = 0
        const total = files.length

        const sendEffects = files.map((file) =>
          Effect.gen(function* () {
            // Always reload from OPFS to ensure sending canonical anonymized bytes
            const loaded = yield* opfs.loadFile(file.id)
            const toSend = { ...file, arrayBuffer: loaded }
            yield* sender.sendFile(toSend, config)
            completed++
            options?.onProgress?.(completed, total, toSend)
            return toSend
          })
        )

        const results = yield* Effect.all(sendEffects, { concurrency, batching: true })
        return results
      })
  }
)


