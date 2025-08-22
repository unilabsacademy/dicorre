import { Effect, Context, Layer } from "effect"
import JSZip from 'jszip'
import type { DicomStudy } from '@/types/dicom'
import { OPFSStorage } from '@/services/opfsStorage'
import { StorageError, type StorageErrorType } from '@/types/effects'

export class DownloadService extends Context.Tag("DownloadService")<
  DownloadService,
  {
    readonly packageStudiesForDownload: (studies: DicomStudy[], studyIds: string[]) => Effect.Effect<Blob, StorageErrorType, OPFSStorage>
  }
>() {}

class DownloadServiceImpl {
  static packageStudiesForDownload = (studies: DicomStudy[], studyIds: string[]) => 
    Effect.gen(function* () {
      const opfsStorage = yield* OPFSStorage
      const zip = new JSZip()

      // Get all available files from OPFS
      const availableFileIds = yield* opfsStorage.listFiles

      // Filter studies by the provided IDs
      const selectedStudies = studies.filter(study => 
        studyIds.includes(study.studyInstanceUID)
      )

      if (selectedStudies.length === 0) {
        yield* Effect.logWarning('No studies found matching the provided IDs')
        return yield* Effect.succeed(new Blob([], { type: 'application/zip' }))
      }

      yield* Effect.logInfo(`Packaging ${selectedStudies.length} studies for download`)

      // Process each study
      for (const study of selectedStudies) {
        yield* DownloadServiceImpl.organizeStudyIntoFolders(study, zip, availableFileIds, opfsStorage)
      }

      // Generate and return the zip blob
      const blob = yield* Effect.tryPromise({
        try: () => zip.generateAsync({ type: 'blob' }),
        catch: (error) => new StorageError({
          message: `Failed to generate ZIP file: ${error}`,
          operation: 'package'
        })
      })

      yield* Effect.logInfo(`Successfully created download package with ${Object.keys(zip.files).length} files`)
      return blob
    })

  private static organizeStudyIntoFolders = (
    study: DicomStudy,
    zip: JSZip,
    availableFileIds: string[],
    opfsStorage: Context.Tag.Service<OPFSStorage>
  ) =>
    Effect.gen(function* () {
      // Create folder structure: PatientID/StudyInstanceUID/SeriesInstanceUID/
      const patientFolder = DownloadServiceImpl.sanitizeFolderName(study.patientId || 'Unknown_Patient')
      const studyFolder = DownloadServiceImpl.sanitizeFolderName(study.studyInstanceUID)
      
      for (const series of study.series) {
        const seriesFolder = DownloadServiceImpl.sanitizeFolderName(series.seriesInstanceUID)
        const folderPath = `${patientFolder}/${studyFolder}/${seriesFolder}`
        
        for (const file of series.files) {
          // Check if file exists in OPFS using opfsFileId
          const fileId = file.opfsFileId || file.id
          
          if (availableFileIds.includes(fileId)) {
            const fileData = yield* opfsStorage.loadFile(fileId)
            
            // Use original filename or create one based on instance number
            const fileName = file.fileName || `${file.metadata?.instanceNumber || 'image'}.dcm`
            const sanitizedFileName = DownloadServiceImpl.sanitizeFileName(fileName)
            const fullPath = `${folderPath}/${sanitizedFileName}`
            
            zip.file(fullPath, fileData)
            yield* Effect.logDebug(`Added file to zip: ${fullPath}`)
          } else {
            yield* Effect.logWarning(`File not found in OPFS: ${fileId}`)
          }
        }
      }
    })

  private static sanitizeFolderName = (name: string): string => {
    // Remove or replace characters that are invalid in folder names
    return name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 255) // Limit length
  }

  private static sanitizeFileName = (filename: string): string => {
    // Remove or replace characters that are invalid in filenames
    return filename
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 255) // Limit length
  }
}

export const DownloadServiceLive = Layer.succeed(
  DownloadService,
  DownloadService.of({
    packageStudiesForDownload: DownloadServiceImpl.packageStudiesForDownload
  })
)