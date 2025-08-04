import { Effect, Context, Layer } from "effect"
import {
  DicomDeidentifier,
  BasicProfile,
  CleanDescOption,
  CleanGraphOption,
  RetainDeviceIdentOption
} from '@umessen/dicom-deidentifier'
import * as dcmjs from 'dcmjs'
import type { DicomFile, AnonymizationConfig } from '@/types/dicom'
import { DicomProcessor } from '../dicomProcessor'
import { ConfigService } from '../config'
import { getAllSpecialHandlers } from './handlers'
import { getDicomReferenceDate, getDicomReferenceTime } from './dicomHelpers'
import { AnonymizationError, ConfigurationError, type AnonymizerError } from '@/types/effects'

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
    readonly anonymizeFile: (file: DicomFile, config: AnonymizationConfig, sharedTimestamp?: string) => Effect.Effect<DicomFile, AnonymizerError>
    readonly anonymizeFiles: (files: DicomFile[], config: AnonymizationConfig, options?: { concurrency?: number; onProgress?: (progress: AnonymizationProgress) => void }) => Effect.Effect<DicomFile[], AnonymizerError>
    readonly anonymizeInBatches: (files: DicomFile[], config: AnonymizationConfig, batchSize?: number, onBatchComplete?: (batchIndex: number, totalBatches: number) => void) => Effect.Effect<DicomFile[], AnonymizerError>
    readonly anonymizeStudy: (studyId: string, files: DicomFile[], config: AnonymizationConfig, options?: { concurrency?: number; onProgress?: (progress: AnonymizationProgress) => void }) => Effect.Effect<StudyAnonymizationResult, AnonymizerError>
    readonly validateConfig: (config: AnonymizationConfig) => Effect.Effect<void, ConfigurationError>
  }
>() { }

/**
 * Internal implementation class
 */
class AnonymizerImpl {
  /**
   * Effect-based configuration validation
   */
  static validateConfig = (config: AnonymizationConfig): Effect.Effect<void, ConfigurationError> =>
    Effect.gen(function* () {
      // Validate profile
      if (!['basic', 'clean', 'very-clean'].includes(config.profile)) {
        return yield* Effect.fail(new ConfigurationError({
          message: `Invalid anonymization profile: ${config.profile}`,
          setting: "profile",
          value: config.profile
        }))
      }

      // Validate dateJitterDays if present
      if (config.dateJitterDays !== undefined) {
        if (config.dateJitterDays < 0 || config.dateJitterDays > 365) {
          return yield* Effect.fail(new ConfigurationError({
            message: `Invalid dateJitterDays value: ${config.dateJitterDays}. Must be between 0 and 365.`,
            setting: "dateJitterDays",
            value: config.dateJitterDays
          }))
        }
      }

      // Validate preserveTags format if present
      if (config.preserveTags) {
        for (const tag of config.preserveTags) {
          if (!/^[0-9A-Fa-f]{8}$/.test(tag)) {
            return yield* Effect.fail(new ConfigurationError({
              message: `Invalid DICOM tag format: ${tag}. Expected 8 hexadecimal characters.`,
              setting: "preserveTags",
              value: tag
            }))
          }
        }
      }

      // Validate tagsToRemove patterns if present
      if (config.tagsToRemove) {
        for (const pattern of config.tagsToRemove) {
          if (pattern.length === 0) {
            return yield* Effect.fail(new ConfigurationError({
              message: "Empty tag removal pattern found",
              setting: "tagsToRemove",
              value: pattern
            }))
          }
        }
      }
    })

  /**
   * Effect-based file anonymization with service dependencies
   * Optional sharedTimestamp parameter to ensure consistent values across multiple files
   */
  static anonymizeFile = (file: DicomFile, config: AnonymizationConfig, sharedTimestamp?: string): Effect.Effect<DicomFile, AnonymizerError, DicomProcessor | ConfigService> =>
    Effect.gen(function* () {
      const configService = yield* ConfigService
      const dicomProcessor = yield* DicomProcessor

      // Validate configuration first
      yield* AnonymizerImpl.validateConfig(config)

      // Check if file has metadata
      if (!file.metadata) {
        return yield* Effect.fail(new AnonymizationError({
          message: `File ${file.fileName} has no metadata - cannot anonymize`,
          fileName: file.fileName
        }))
      }

      // Get processed replacements from config service with optional shared timestamp
      console.log('Processing replacements from config:', config.replacements)
      const processedReplacements = yield* configService.processReplacements(
        (config.replacements || {}) as Record<string, string>,
        sharedTimestamp
      )
      console.log('Processed replacements result:', processedReplacements)

      // Perform anonymization using the existing legacy method
      const result = yield* Effect.tryPromise({
        try: () => AnonymizerImpl.anonymizeFileInternal(file, config, processedReplacements),
        catch: (error) => new AnonymizationError({
          message: `Failed to anonymize file: ${file.fileName}`,
          fileName: file.fileName,
          cause: error
        })
      })

      // Re-parse the anonymized file
      const finalFile = yield* dicomProcessor.parseFile(result)
      console.log(`Successfully anonymized ${file.fileName}`)
      return finalFile
    })

  /**
   * Internal anonymization method (extracted from legacy code)
   */
  private static anonymizeFileInternal(file: DicomFile, config: AnonymizationConfig, processedReplacements: Record<string, string>): Promise<DicomFile> {
    return new Promise((resolve, reject) => {
      try {
        console.log(`Starting anonymization of file: ${file.fileName}`)

        // Select profile based on config
        let profileOptions: any[] = []
        switch (config.profile) {
          case 'clean':
            profileOptions = [CleanDescOption]
            break
          case 'very-clean':
            profileOptions = [CleanGraphOption]
            break
          case 'basic':
          default:
            profileOptions = [BasicProfile]
            break
        }

        // Configure deidentifier options
        const deidentifierConfig = {
          profileOptions: profileOptions,
          dummies: {
            default: processedReplacements.default || 'REMOVED',
            lookup: {
              // Use config replacements with fallbacks
              '00100010': processedReplacements.patientName || 'ANONYMOUS', // Patient Name
              '00100020': processedReplacements.patientId || 'ANON001', // Patient ID
              '00100030': processedReplacements.patientBirthDate || '19000101', // Patient Birth Date
              '00080080': processedReplacements.institution || 'ANONYMIZED', // Institution Name
              '00080050': processedReplacements.accessionNumber || 'ACA0000000', // Accession Number
              // Add any custom replacements
              ...config.customReplacements
            }
          },
          keep: config.preserveTags || [
            // Default essential technical tags for image interpretation
            '00080016', // SOP Class UID
            '00080018', // SOP Instance UID
            '0020000D', // Study Instance UID
            '0020000E', // Series Instance UID
            '00200013', // Instance Number
          ]
        }

        // Add option to remove private tags if requested
        if (config.removePrivateTags) {
          // This should add an option to REMOVE private tags, not retain them
          // The library might have a specific option for this
          console.log('removePrivateTags is enabled, but the library may not support this directly')
        }

        // Add custom special handlers if enabled
        if (config.useCustomHandlers) {
          const tagsToRemove = config.tagsToRemove || []
          const specialHandlers = getAllSpecialHandlers(config.dateJitterDays || 31, tagsToRemove)
          // @ts-expect-error - specialHandlers property may not be in official types
          deidentifierConfig.specialHandlers = specialHandlers
        }

        // Add helper functions for handling missing DICOM dates/times
        deidentifierConfig.getReferenceDate = getDicomReferenceDate
        deidentifierConfig.getReferenceTime = getDicomReferenceTime

        // Create deidentifier instance
        let deidentifier: any
        try {
          deidentifier = new DicomDeidentifier(deidentifierConfig)
          console.log(`Created deidentifier for ${file.fileName} with ${config.useCustomHandlers ? 'custom' : 'standard'} handlers`)
        } catch (deidentifierError) {
          console.error(`Failed to create deidentifier:`, deidentifierError)
          throw new Error(`Cannot create anonymizer: ${deidentifierError}`)
        }

        // Convert ArrayBuffer to Uint8Array for the deidentifier
        const uint8Array = new Uint8Array(file.arrayBuffer)
        console.log(`Converted to Uint8Array for ${file.fileName}, size: ${uint8Array.length}`)

        // Anonymize the DICOM file
        let anonymizedUint8Array: Uint8Array
        try {
          anonymizedUint8Array = deidentifier.deidentify(uint8Array)
          console.log(`Deidentified ${file.fileName} using library, result size: ${anonymizedUint8Array.length}`)
        } catch (deidentifyError: any) {
          console.error(`Library deidentification failed:`, deidentifyError)
          console.error(`Error stack:`, deidentifyError.stack)

          // Try to provide more context about the error
          if (deidentifyError.message?.includes("Cannot read properties of undefined")) {
            console.error(`This might be due to malformed DICOM tags or unsupported private tags in ${file.fileName}`)
            console.error(`Consider enabling removePrivateTags option or checking the DICOM file structure`)
          }

          throw new Error(`Cannot anonymize file ${file.fileName}: ${deidentifyError.message || deidentifyError}`)
        }

        // Convert back to ArrayBuffer
        const anonymizedArrayBuffer = anonymizedUint8Array.buffer.slice(
          anonymizedUint8Array.byteOffset,
          anonymizedUint8Array.byteOffset + anonymizedUint8Array.byteLength
        )

        // Return new file with anonymized data
        const anonymizedFile: DicomFile = {
          ...file,
          arrayBuffer: anonymizedArrayBuffer,
          anonymized: true
        }

        resolve(anonymizedFile)
      } catch (error) {
        console.error(`Error anonymizing file ${file.fileName}:`, error)
        reject(new Error(`Failed to anonymize file: ${file.fileName}`))
      }
    })
  }

  /**
   * Anonymize multiple files concurrently with shared timestamp for consistent grouping
   */
  static anonymizeFiles = (
    files: DicomFile[],
    config: AnonymizationConfig,
    options: { concurrency?: number; onProgress?: (progress: AnonymizationProgress) => void } = {}
  ): Effect.Effect<DicomFile[], AnonymizerError, DicomProcessor | ConfigService> =>
    Effect.gen(function* () {
      const { concurrency = 3, onProgress } = options
      let completed = 0
      const total = files.length

      // Generate shared timestamp for consistent replacements across all files
      const sharedTimestamp = Date.now().toString().slice(-7)
      console.log(`[Effect Anonymizer] Using shared timestamp for ${files.length} files: ${sharedTimestamp}`)

      // Create individual effects that update progress
      const effectsWithProgress = files.map((file, index) =>
        Effect.gen(function* () {
          if (onProgress) {
            onProgress({
              total,
              completed,
              percentage: Math.round((completed / total) * 100),
              currentFile: file.fileName
            })
          }

          const result = yield* AnonymizerImpl.anonymizeFile(file, config, sharedTimestamp)

          completed++
          if (onProgress) {
            onProgress({
              total,
              completed,
              percentage: Math.round((completed / total) * 100),
              currentFile: file.fileName
            })
          }

          return result
        })
      )

      // Run all effects concurrently
      const results = yield* Effect.all(effectsWithProgress, { concurrency, batching: true })

      return results
    })

  /**
   * Anonymize files in batches (useful for very large datasets)
   * Each batch gets its own shared timestamp for consistent grouping within the batch
   */
  static anonymizeInBatches = (
    files: DicomFile[],
    config: AnonymizationConfig,
    batchSize = 10,
    onBatchComplete?: (batchIndex: number, totalBatches: number) => void
  ): Effect.Effect<DicomFile[], AnonymizerError, DicomProcessor | ConfigService> =>
    Effect.gen(function* () {
      const results: DicomFile[] = []
      const totalBatches = Math.ceil(files.length / batchSize)

      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize)
        const batchResults = yield* AnonymizerImpl.anonymizeFiles(batch, config)
        results.push(...batchResults)

        if (onBatchComplete) {
          onBatchComplete(Math.floor(i / batchSize) + 1, totalBatches)
        }
      }

      return results
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
      
      // Validate configuration first
      yield* AnonymizerImpl.validateConfig(config)
      
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
    anonymizeFiles: AnonymizerImpl.anonymizeFiles,
    anonymizeInBatches: AnonymizerImpl.anonymizeInBatches,
    anonymizeStudy: AnonymizerImpl.anonymizeStudy,
    validateConfig: AnonymizerImpl.validateConfig
  })
)
