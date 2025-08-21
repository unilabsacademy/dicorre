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
import { getAllSpecialHandlers } from './handlers'
import { getDicomReferenceDate, getDicomReferenceTime } from './dicomHelpers'
import { AnonymizationError, type AnonymizerError } from '@/types/effects'
import { tag } from '@/utils/dicom-tag-dictionary'

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
    readonly anonymizeFile: (file: DicomFile, config: AnonymizationConfig, sharedTimestamp?: string) => Effect.Effect<DicomFile, AnonymizerError, DicomProcessor>
    readonly anonymizeStudy: (studyId: string, files: DicomFile[], config: AnonymizationConfig, options?: { concurrency?: number; onProgress?: (progress: AnonymizationProgress) => void }) => Effect.Effect<StudyAnonymizationResult, AnonymizerError, DicomProcessor>
  }
>() { }

class AnonymizerImpl {
  private static processReplacements = (replacements: Record<string, string | undefined>, sharedTimestamp?: string): Record<string, string> => {
    const processed: Record<string, string> = {}
    const timestamp = sharedTimestamp || Date.now().toString().slice(-7)

    for (const [key, value] of Object.entries(replacements)) {
      if (typeof value === 'string') {
        processed[key] = value.replace('{timestamp}', timestamp)
      }
    }

    return processed
  }

  static anonymizeFile = (file: DicomFile, config: AnonymizationConfig, sharedTimestamp?: string): Effect.Effect<DicomFile, AnonymizerError, DicomProcessor> =>
    Effect.gen(function* () {
      const dicomProcessor = yield* DicomProcessor

      // Check if file has metadata
      if (!file.metadata) {
        return yield* Effect.fail(new AnonymizationError({
          message: `File ${file.fileName} has no metadata - cannot anonymize`,
          fileName: file.fileName
        }))
      }

      console.log(`Starting anonymization of file: ${file.fileName}`)

      // Process replacements with optional shared timestamp
      console.log('Processing replacements from config:', config.replacements)
      const processedReplacements = AnonymizerImpl.processReplacements(
        config.replacements || {},
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
            [tag("Patient's Name")]: processedReplacements.patientName || 'ANONYMOUS',
            [tag('Patient ID')]: processedReplacements.patientId || 'ANON001',
            [tag("Patient's Birth Date")]: processedReplacements.patientBirthDate || '19000101',
            [tag('Institution Name')]: processedReplacements.institution || 'ANONYMIZED',
            [tag('Accession Number')]: processedReplacements.accessionNumber || 'ANON0000000',
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
        // For individual files, use the Study Instance UID as the cache key
        const studyId = file.metadata?.studyInstanceUID || 'unknown'
        const specialHandlers = getAllSpecialHandlers(config.dateJitterDays || 31, tagsToRemove, studyId)
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

  static anonymizeStudy = (
    studyId: string,
    files: DicomFile[],
    config: AnonymizationConfig,
    options: { concurrency?: number; onProgress?: (progress: AnonymizationProgress) => void } = {}
  ): Effect.Effect<StudyAnonymizationResult, AnonymizerError, DicomProcessor> =>
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

export const AnonymizerLive = Layer.succeed(
  Anonymizer,
  Anonymizer.of({
    anonymizeFile: AnonymizerImpl.anonymizeFile,
    anonymizeStudy: AnonymizerImpl.anonymizeStudy
  })
)
