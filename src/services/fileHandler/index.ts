import { Effect, Context, Layer } from "effect"
import JSZip from 'jszip'
import type { DicomFile } from '@/types/dicom'
import { FileHandlerError, ValidationError, type FileHandlerErrorType } from '@/types/effects'

export class FileHandler extends Context.Tag("FileHandler")<
  FileHandler,
  {
    readonly extractZipFile: (file: File) => Effect.Effect<DicomFile[], FileHandlerErrorType>
    readonly readSingleDicomFile: (file: File) => Effect.Effect<DicomFile, FileHandlerErrorType>
    readonly validateDicomFile: (arrayBuffer: ArrayBuffer, fileName: string) => Effect.Effect<boolean, ValidationError>
  }
>() { }

class FileHandlerImpl {
  private static generateFileId(): string {
    return `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Effect-based DICOM file validation
   */
  static validateDicomFile = (arrayBuffer: ArrayBuffer, fileName: string): Effect.Effect<boolean, ValidationError> =>
    Effect.gen(function* () {
      if (arrayBuffer.byteLength === 0) {
        return yield* Effect.fail(new ValidationError({
          message: `File ${fileName} is empty`,
          fileName
        }))
      }

      const view = new DataView(arrayBuffer)

      // Method 1: Check for DICOM magic number "DICM" at position 128
      if (arrayBuffer.byteLength > 132) {
        try {
          const magic = String.fromCharCode(
            view.getUint8(128),
            view.getUint8(129),
            view.getUint8(130),
            view.getUint8(131)
          )

          if (magic === 'DICM') {
            return true
          }
        } catch (error) {
          return yield* Effect.fail(new ValidationError({
            message: `Error reading DICOM magic number in ${fileName} - ${error}`,
            fileName,
          }))
        }
      }

      // Method 2: Check for common DICOM file extensions
      const ext = fileName.split('.').pop()?.toLowerCase() || ''
      if (['dcm', 'dicom', 'dic'].includes(ext)) {
        return true
      }

      // Method 3: For files without extensions, be more permissive
      if (!fileName.includes('.') && arrayBuffer.byteLength > 1000) {
        try {
          // Look for DICOM group/element tags at the beginning
          const group1 = view.getUint16(0, true)

          // Common starting tags for DICOM files
          if (
            (group1 === 0x0008) || // Identifying Information
            (group1 === 0x0010) || // Patient Information
            (group1 === 0x0018) || // Acquisition Information
            (group1 === 0x0020) || // Relationship Information
            (group1 === 0x0002)    // File Meta Information
          ) {
            return true
          }

          // Also check a few bytes in for implicit VR files
          if (arrayBuffer.byteLength > 16) {
            const group2 = view.getUint16(8, true)

            if (
              (group2 === 0x0008) ||
              (group2 === 0x0010) ||
              (group2 === 0x0018) ||
              (group2 === 0x0020)
            ) {
              return true
            }
          }
        } catch (error) {
          return yield* Effect.fail(new ValidationError({
            message: `Error checking DICOM patterns in ${fileName} - ${error}`,
            fileName,
          }))
        }
      }

      return false
    })

  /**
   * Effect-based ZIP file extraction
   */
  static extractZipFile = (file: File): Effect.Effect<DicomFile[], FileHandlerErrorType> =>
    Effect.gen(function* () {
      const zip = new JSZip()

      const zipContent = yield* Effect.tryPromise({
        try: () => zip.loadAsync(file),
        catch: (error) => new FileHandlerError({
          message: `Failed to load ZIP file: ${file.name}`,
          fileName: file.name,
          cause: error
        })
      })

      const fileEntries = Object.keys(zipContent.files)

      // Process files concurrently with Effect
      const processFile = (fileName: string) =>
        Effect.gen(function* () {
          const zipFile = zipContent.files[fileName]

          // Skip directories and hidden files
          if (zipFile.dir || fileName.startsWith('.') || fileName.includes('/.')) {
            return null
          }

          const arrayBuffer = yield* Effect.tryPromise({
            try: () => zipFile.async('arraybuffer'),
            catch: (error) => new FileHandlerError({
              message: `Failed to read file ${fileName} from ZIP`,
              fileName,
              cause: error
            })
          })

          // Skip very small files
          if (arrayBuffer.byteLength < 100) {
            return null
          }

          // Validate DICOM file
          const isDicom = yield* FileHandlerImpl.validateDicomFile(arrayBuffer, fileName)

          if (isDicom) {
            return {
              id: FileHandlerImpl.generateFileId(),
              fileName: fileName.split('/').pop() || fileName,
              fileSize: arrayBuffer.byteLength,
              arrayBuffer,
              anonymized: false
            } as DicomFile
          }

          return null
        })

      // Process all files concurrently
      const results = yield* Effect.all(
        fileEntries.map(processFile),
        { concurrency: 5, batching: true }
      )

      // Filter out null results
      return results.filter((file): file is DicomFile => file !== null)
    })

  /**
   * Effect-based single DICOM file reading
   */
  static readSingleDicomFile = (file: File): Effect.Effect<DicomFile, FileHandlerErrorType> =>
    Effect.gen(function* () {
      const arrayBuffer = yield* Effect.tryPromise({
        try: () => file.arrayBuffer(),
        catch: (error) => new FileHandlerError({
          message: `Failed to read file: ${file.name}`,
          fileName: file.name,
          cause: error
        })
      })

      // Validate the file if it's supposed to be a DICOM file
      if (file.name.toLowerCase().endsWith('.dcm') || file.name.toLowerCase().endsWith('.dicom')) {
        yield* FileHandlerImpl.validateDicomFile(arrayBuffer, file.name)
      }

      return {
        id: FileHandlerImpl.generateFileId(),
        fileName: file.name,
        fileSize: file.size,
        arrayBuffer,
        anonymized: false
      }
    })
}

/**
 * Live implementation layer
 */
export const FileHandlerLive = Layer.succeed(
  FileHandler,
  FileHandler.of({
    extractZipFile: FileHandlerImpl.extractZipFile,
    readSingleDicomFile: FileHandlerImpl.readSingleDicomFile,
    validateDicomFile: FileHandlerImpl.validateDicomFile
  })
)
