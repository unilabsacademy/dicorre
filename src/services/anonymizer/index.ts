import { Effect, Context, Layer } from "effect"
import {
  DicomDeidentifier,
  BasicProfile,
  CleanDescOption,
  CleanGraphOption,
  type DeidentifyOptions
} from '@umessen/dicom-deidentifier'
import type { DicomFile, AnonymizationConfig } from '@/types/dicom'
import { DicomProcessor } from '../dicomProcessor'
import { ConfigService } from '../config'
import { getAllSpecialHandlers } from './handlers'
import { getDicomReferenceDate, getDicomReferenceTime } from './dicomHelpers'
import { AnonymizationError, type AnonymizerError } from '@/types/effects'

export interface AnonymizationProgress {
  total: number
  completed: number
  percentage: number
  currentFile?: string
}

export interface StudyAnonymizationResult {
  studyId: string
  anonymizedFiles: DicomFile[]
  totalFiles: number
  completedFiles: number
}

export class Anonymizer extends Context.Tag("Anonymizer")<
  Anonymizer,
  {
    readonly anonymizeFile: (file: DicomFile, config: AnonymizationConfig, sharedTimestamp?: string) => Effect.Effect<DicomFile, AnonymizerError, DicomProcessor | ConfigService>
    readonly anonymizeStudy: (studyId: string, files: DicomFile[], config: AnonymizationConfig, options?: { concurrency?: number; onProgress?: (progress: AnonymizationProgress) => void }) => Effect.Effect<StudyAnonymizationResult, AnonymizerError, DicomProcessor | ConfigService>
  }
>() { }

/**
 * Internal implementation class
 */
class AnonymizerImpl {
  /**
   * Effect-based file anonymization with service dependencies
   * Optional sharedTimestamp parameter to ensure consistent values across multiple files
   */
  static anonymizeFile = (file: DicomFile, config: AnonymizationConfig, sharedTimestamp?: string): Effect.Effect<DicomFile, AnonymizerError, DicomProcessor | ConfigService> =>
    Effect.gen(function* () {
      const configService = yield* ConfigService
      const dicomProcessor = yield* DicomProcessor

      // Check if file has metadata
      if (!file.metadata) {
        return yield* Effect.fail(new AnonymizationError({
          message: `File ${file.fileName} has no metadata - cannot anonymize`,
          fileName: file.fileName
        }))
      }

      console.log(`Starting anonymization of file: ${file.fileName}`)

      // Get processed replacements from config service with optional shared timestamp
      console.log('Processing replacements from config:', config.replacements)
      const processedReplacements = yield* configService.processReplacements(
        (config.replacements || {}) as Record<string, string>,
        sharedTimestamp
      )
      console.log('Processed replacements result:', processedReplacements)

      // Select profile based on config
      const profileOptions = yield* Effect.sync(() => {
        switch (config.profile) {
          case 'clean':
            return [CleanDescOption]
          case 'very-clean':
            return [CleanGraphOption]
          case 'basic':
          default:
            return [BasicProfile]
        }
      })

      // Configure deidentifier options
      const deidentifierConfig: DeidentifyOptions = {
        profileOptions,
        dummies: {
          default: processedReplacements.default || 'REMOVED',
          lookup: {
            // Use config replacements with fallbacks
            '00100010': processedReplacements.patientName || 'ANONYMOUS', // Patient Name
            '00100020': processedReplacements.patientId || 'ANON001', // Patient ID
            '00100030': processedReplacements.patientBirthDate || '19000101', // Patient Birth Date
            '00080080': processedReplacements.institution || 'ANONYMIZED', // Institution Name
            '00080050': processedReplacements.accessionNumber || 'ANON0000000', // Accession Number
            // Add any custom replacements
            ...config.customReplacements
          }
        },
        keep: config.preserveTags,
        getReferenceDate: getDicomReferenceDate,
        getReferenceTime: getDicomReferenceTime
      }

      // Add custom special handlers if enabled
      if (config.useCustomHandlers) {
        const tagsToRemove = config.tagsToRemove || []
        const specialHandlers = getAllSpecialHandlers(config.dateJitterDays || 31, tagsToRemove)
        deidentifierConfig.specialHandlers = specialHandlers
      }

      // Create deidentifier instance
      const deidentifier = yield* Effect.try({
        try: () => {
          const instance = new DicomDeidentifier(deidentifierConfig)
          console.log(`Created deidentifier for ${file.fileName} with ${config.useCustomHandlers ? 'custom' : 'standard'} handlers`)
          return instance
        },
        catch: (error) => new AnonymizationError({
          message: `Cannot create anonymizer: ${error}`,
          fileName: file.fileName,
          cause: error
        })
      })

      // Convert ArrayBuffer to Uint8Array for the deidentifier
      const uint8Array = new Uint8Array(file.arrayBuffer)
      console.log(`Converted to Uint8Array for ${file.fileName}, size: ${uint8Array.length}`)

      // Anonymize the DICOM file
      const anonymizedUint8Array = yield* Effect.try({
        try: () => {
          const result = deidentifier.deidentify(uint8Array)
          console.log(`Deidentified ${file.fileName} using library, result size: ${result.length}`)
          return result
        },
        catch: (error: any) => {
          console.error(`Library deidentification failed:`, error)
          console.error(`Error stack:`, error.stack)

          // Try to provide more context about the error
          if (error.message?.includes("Cannot read properties of undefined")) {
            console.error(`This might be due to malformed DICOM tags or unsupported private tags in ${file.fileName}`)
            console.error(`Consider enabling removePrivateTags option or checking the DICOM file structure`)
          }

          return new AnonymizationError({
            message: `Cannot anonymize file ${file.fileName}: ${error.message || error}`,
            fileName: file.fileName,
            cause: error
          })
        }
      })

      // Convert back to ArrayBuffer
      const anonymizedArrayBuffer = anonymizedUint8Array.buffer.slice(
        anonymizedUint8Array.byteOffset,
        anonymizedUint8Array.byteOffset + anonymizedUint8Array.byteLength
      )

      // Create anonymized file with new data
      const anonymizedFile: DicomFile = {
        ...file,
        arrayBuffer: anonymizedArrayBuffer,
        anonymized: true
      }

      // Re-parse the anonymized file
      const finalFile = yield* dicomProcessor.parseFile(anonymizedFile)
      console.log(`Successfully anonymized ${file.fileName}`)
      return finalFile
    })

  /**
   * Anonymize study with coordinated file processing
   * This is the main orchestration method that should be used for study-level anonymization
   */
  static anonymizeStudy = (
    studyId: string,
    files: DicomFile[],
    config: AnonymizationConfig,
    options: { concurrency?: number; onProgress?: (progress: AnonymizationProgress) => void } = {}
  ): Effect.Effect<StudyAnonymizationResult, AnonymizerError, DicomProcessor | ConfigService> =>
    Effect.gen(function* () {
      const { concurrency = 3, onProgress } = options

      console.log(`[Effect Anonymizer] Starting anonymization of study ${studyId} with ${files.length} files`)

      // Generate shared timestamp for consistent replacements across all files in this study
      const sharedTimestamp = Date.now().toString().slice(-7)
      console.log(`[Effect Anonymizer] Using shared timestamp for study ${studyId}: ${sharedTimestamp}`)

      let completed = 0
      const total = files.length

      // Create individual effects with progress tracking
      const effectsWithProgress = files.map((file, index) =>
        Effect.gen(function* () {
          // Send progress update before processing
          if (onProgress) {
            onProgress({
              total,
              completed,
              percentage: Math.round((completed / total) * 100),
              currentFile: file.fileName
            })
          }

          console.log(`[Effect Anonymizer] Starting file ${index + 1}/${total}: ${file.fileName}`)

          // Anonymize individual file with shared timestamp
          const result = yield* AnonymizerImpl.anonymizeFile(file, config, sharedTimestamp)

          completed++

          // Send progress update after completion
          if (onProgress) {
            onProgress({
              total,
              completed,
              percentage: Math.round((completed / total) * 100),
              currentFile: file.fileName
            })
          }

          console.log(`[Effect Anonymizer] Completed file ${index + 1}/${total}: ${file.fileName}`)
          return result
        })
      )

      // Run all effects concurrently with specified concurrency
      const anonymizedFiles = yield* Effect.all(effectsWithProgress, { concurrency, batching: true })

      console.log(`[Effect Anonymizer] Study ${studyId} anonymization completed: ${anonymizedFiles.length} files processed`)

      return {
        studyId,
        anonymizedFiles,
        totalFiles: total,
        completedFiles: anonymizedFiles.length
      }
    })
}

/**
 * Live implementation layer with dependencies
 */
export const AnonymizerLive = Layer.succeed(
  Anonymizer,
  Anonymizer.of({
    anonymizeFile: AnonymizerImpl.anonymizeFile,
    anonymizeStudy: AnonymizerImpl.anonymizeStudy
  })
)
