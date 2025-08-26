import { Effect, Context, Layer } from "effect"
import JSZip from 'jszip'
import type { DicomFile } from '@/types/dicom'
import { FileHandlerError, ValidationError, type FileHandlerErrorType } from '@/types/effects'
import { PluginRegistry } from '@/services/pluginRegistry'

export class FileHandler extends Context.Tag("FileHandler")<
  FileHandler,
  {
    readonly extractZipFile: (file: File, options?: { onProgress?: (completed: number, total: number, currentFile?: string) => void }) => Effect.Effect<DicomFile[], FileHandlerErrorType>
    readonly readSingleDicomFile: (file: File) => Effect.Effect<DicomFile, FileHandlerErrorType>
    readonly validateDicomFile: (arrayBuffer: ArrayBuffer, fileName: string) => Effect.Effect<boolean, ValidationError>
    readonly processFile: (file: File) => Effect.Effect<DicomFile[], FileHandlerErrorType>
  }
>() { }

/**
 * Live implementation layer
 */
export const FileHandlerLive = Layer.effect(
  FileHandler,
  Effect.gen(function* () {
    const registry = yield* PluginRegistry
    
    const generateFileId = (): string => {
      return `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    }

    const validateDicomFile = (arrayBuffer: ArrayBuffer, fileName: string): Effect.Effect<boolean, ValidationError> =>
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

        // Method 2: Look for Group 0002 (File Meta Information) tags at the start
        try {
          // Check for group 0002 elements which should be present in DICOM files
          for (let i = 128; i < Math.min(arrayBuffer.byteLength - 8, 1000); i += 2) {
            const group = view.getUint16(i, true) // little endian
            const element = view.getUint16(i + 2, true)

            // Check for common Group 0002 elements
            if (group === 0x0002) {
              console.log(`Found DICOM Group 0002 tag at position ${i}: (${group.toString(16).padStart(4, '0')},${element.toString(16).padStart(4, '0')})`)
              return true
            }
          }
        } catch (error) {
          console.warn(`Error checking for DICOM tags in ${fileName}:`, error)
          // Continue to fallback method
        }

        // Method 3: Check for common system files that should not be treated as DICOM
        const lowerFileName = fileName.toLowerCase()
        const systemFiles = ['.ds_store', 'thumbs.db', 'desktop.ini', '.git', '.svn']
        if (systemFiles.some(sysFile => lowerFileName.includes(sysFile))) {
          return yield* Effect.fail(new ValidationError({
            message: `File ${fileName} is a system file, not a DICOM file`,
            fileName,
          }))
        }

        // Method 4: Fallback - assume it's DICOM if it has reasonable size and no clear non-DICOM markers
        if (arrayBuffer.byteLength > 1000) {
          console.log(`Assuming ${fileName} is DICOM based on size and lack of non-DICOM markers`)
          return true
        }

        return yield* Effect.fail(new ValidationError({
          message: `File ${fileName} does not appear to be a valid DICOM file`,
          fileName,
        }))
      })

    const readSingleDicomFile = (file: File): Effect.Effect<DicomFile, FileHandlerErrorType> =>
      Effect.gen(function* () {
        const arrayBuffer = yield* Effect.tryPromise({
          try: () => file.arrayBuffer(),
          catch: (error) => new FileHandlerError({
            message: `Failed to read file: ${file.name}`,
            fileName: file.name,
            cause: error
          })
        })

        // Validate that it's a DICOM file
        yield* validateDicomFile(arrayBuffer, file.name)

        return {
          id: generateFileId(),
          fileName: file.name,
          fileSize: file.size,
          arrayBuffer,
          anonymized: false
        }
      })

    const extractZipFile = (
      file: File,
      options?: { onProgress?: (completed: number, total: number, currentFile?: string) => void }
    ): Effect.Effect<DicomFile[], FileHandlerErrorType> =>
      Effect.gen(function* () {
        // Read the ZIP file
        const arrayBuffer = yield* Effect.tryPromise({
          try: () => file.arrayBuffer(),
          catch: (error) => new FileHandlerError({
            message: `Failed to read ZIP file: ${file.name}`,
            fileName: file.name,
            cause: error
          })
        })

        // Load the ZIP with JSZip
        const zip = yield* Effect.tryPromise({
          try: () => JSZip.loadAsync(arrayBuffer),
          catch: (error) => new FileHandlerError({
            message: `Failed to parse ZIP file: ${file.name}`,
            fileName: file.name,
            cause: error
          })
        })

        // Get all files in the ZIP
        const zipFiles = Object.values(zip.files).filter(zipFile => !zipFile.dir)
        console.log(`Found ${zipFiles.length} potential files in ZIP archive`)

        if (zipFiles.length === 0) {
          return []
        }

        const dicomFiles: DicomFile[] = []
        let completed = 0
        const total = zipFiles.length

        // Process each file in the ZIP
        for (let i = 0; i < zipFiles.length; i++) {
          const zipFile = zipFiles[i]

          const fileBuffer = yield* Effect.tryPromise({
            try: () => zipFile.async('arraybuffer'),
            catch: (error) => new FileHandlerError({
              message: `Failed to extract file from ZIP: ${zipFile.name}`,
              fileName: zipFile.name,
              cause: error
            })
          })

          // Check if it's a DICOM file
          const isDicom = yield* validateDicomFile(fileBuffer, zipFile.name)
            .pipe(Effect.catchAll(() => Effect.succeed(false)))

          if (isDicom) {
            const dicomFile: DicomFile = {
              id: generateFileId(),
              fileName: zipFile.name,
              fileSize: fileBuffer.byteLength,
              arrayBuffer: fileBuffer,
              anonymized: false
            }
            dicomFiles.push(dicomFile)
          }

          completed++
          // Report actual extraction progress
          options?.onProgress?.(completed, total, zipFile.name)
        }

        console.log(`Extracted ${dicomFiles.length} DICOM files from ${zipFiles.length} total files`)

        if (dicomFiles.length === 0) {
          return yield* Effect.fail(new FileHandlerError({
            message: `No valid DICOM files found in ZIP: ${file.name}`,
            fileName: file.name
          }))
        }

        return dicomFiles
      })

    const processFile = (file: File): Effect.Effect<DicomFile[], FileHandlerErrorType> =>
      Effect.gen(function* () {
        // Check if it's a ZIP file
        if (file.name.toLowerCase().endsWith('.zip')) {
          return yield* extractZipFile(file)
        }
        
        // Check if it's a DICOM file
        const isDicomFile = file.name.toLowerCase().endsWith('.dcm') || 
                           file.name.toLowerCase().endsWith('.dicom') ||
                           !file.name.includes('.')
        
        if (isDicomFile) {
          // Try to read as DICOM first
          const arrayBuffer = yield* Effect.tryPromise({
            try: () => file.arrayBuffer(),
            catch: (error) => new FileHandlerError({
              message: `Failed to read file: ${file.name}`,
              fileName: file.name,
              cause: error
            })
          })
          
          const isValidDicom = yield* validateDicomFile(arrayBuffer, file.name)
            .pipe(Effect.catchAll(() => Effect.succeed(false)))
          
          if (isValidDicom) {
            const dicomFile = yield* readSingleDicomFile(file)
            return [dicomFile]
          }
        }
        
        // Not a DICOM file - check if any plugin can handle it
        const plugin = yield* registry.getPluginForFile(file)
          .pipe(Effect.catchAll(() => Effect.succeed(undefined)))
        
        if (plugin) {
          console.log(`Using plugin ${plugin.id} to process ${file.name}`)
          
          // Create complete metadata for file conversion - all required fields
          const defaultMetadata = {
            patientName: 'Converted^File',
            patientId: `CONV-${Date.now()}`,
            studyInstanceUID: `2.25.${Math.floor(Math.random() * 1e15)}`,
            seriesInstanceUID: `2.25.${Math.floor(Math.random() * 1e15)}`,
            sopInstanceUID: `2.25.${Math.floor(Math.random() * 1e15)}`,
            studyDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
            modality: 'SC', // Secondary Capture
            studyDescription: `Converted from ${file.name}`,
            seriesDescription: 'File Conversion',
            instanceNumber: 1,
            transferSyntaxUID: '1.2.840.10008.1.2.1' // Explicit VR Little Endian
          }
          
          return yield* plugin.convertToDicom(file, defaultMetadata)
            .pipe(
              Effect.mapError((error) => new FileHandlerError({
                message: `Plugin ${plugin.id} failed to convert ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
                fileName: file.name,
                cause: error
              }))
            )
        }
        
        // No plugin found - try to read as DICOM anyway (might be headerless)
        const dicomFile = yield* readSingleDicomFile(file)
        return [dicomFile]
      })
    
    return {
      extractZipFile,
      readSingleDicomFile,
      validateDicomFile,
      processFile
    } as const
  })
)