import { Effect, Context, Layer, PubSub, Stream, pipe } from "effect"
import {
  DicomDeidentifier,
  BasicProfile,
  CleanDescOption,
  CleanGraphOption,
  type DeidentifyOptions
} from '@umessen/dicom-deidentifier'
import type { DicomFile, AnonymizationConfig } from '@/types/dicom'
import type { AnonymizationEvent } from '@/types/events'
import { DicomProcessor } from '../dicomProcessor'
import { ConfigService } from '../config'
import { AnonymizationEventBus } from '../eventBus'
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
    readonly anonymizeFiles: (files: DicomFile[], config: AnonymizationConfig, options?: { concurrency?: number }) => Effect.Effect<DicomFile[], AnonymizerError>
    readonly anonymizeStudyWithEvents: (studyId: string, files: DicomFile[], config: AnonymizationConfig, options?: { concurrency?: number }) => Effect.Effect<DicomFile[], AnonymizerError>
    readonly anonymizeStudy: (studyId: string, files: DicomFile[], config: AnonymizationConfig, options?: { concurrency?: number }) => Effect.Effect<StudyAnonymizationResult, AnonymizerError>
    readonly anonymizeStudyStream: (studyId: string, files: DicomFile[], config: AnonymizationConfig, options?: { concurrency?: number }) => Stream.Stream<AnonymizationEvent, AnonymizerError>
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
          default: processedReplacements.default,
          lookup: config.customReplacements || {},
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
   * Anonymize multiple files concurrently with shared timestamp for consistent grouping
   */
  static anonymizeFiles = (
    files: DicomFile[],
    config: AnonymizationConfig,
    options: { concurrency?: number } = {}
  ): Effect.Effect<DicomFile[], AnonymizerError, DicomProcessor | ConfigService> =>
    Effect.gen(function* () {
      const { concurrency = 3 } = options
      const total = files.length

      // Generate shared timestamp for consistent replacements across all files
      const sharedTimestamp = Date.now().toString().slice(-7)
      console.log(`[Effect Anonymizer] Using shared timestamp for ${files.length} files: ${sharedTimestamp}`)

      // Create individual effects
      const effects = files.map((file) =>
        AnonymizerImpl.anonymizeFile(file, config, sharedTimestamp)
      )

      // Run all effects concurrently
      const results = yield* Effect.all(effects, { concurrency, batching: true })

      return results
    })

  /**
   * Anonymize files with event publishing
   */
  static anonymizeStudyWithEvents = (
    studyId: string,
    files: DicomFile[],
    config: AnonymizationConfig,
    options: { concurrency?: number } = {}
  ): Effect.Effect<DicomFile[], AnonymizerError, DicomProcessor | ConfigService | AnonymizationEventBus> =>
    Effect.gen(function* () {
      const { concurrency = 3 } = options
      const total = files.length
      const sharedTimestamp = Date.now().toString().slice(-7)
      const eventBus = yield* AnonymizationEventBus

      // Emit start event
      yield* PubSub.publish(eventBus, {
        _tag: "AnonymizationStarted",
        studyId,
        totalFiles: total
      } as const)

      console.log(`[Effect Anonymizer Events] Using shared timestamp for ${files.length} files: ${sharedTimestamp}`)

      let completed = 0

      // Process files and emit events
      const processFile = (file: DicomFile) =>
        Effect.gen(function* () {
          const result = yield* AnonymizerImpl.anonymizeFile(file, config, sharedTimestamp)
          completed++

          // Emit progress event
          yield* PubSub.publish(eventBus, {
            _tag: "AnonymizationProgress",
            studyId,
            completed,
            total,
            currentFile: file.fileName
          } as const)

          // Emit file completed event
          yield* PubSub.publish(eventBus, {
            _tag: "FileAnonymized",
            studyId,
            file: result
          } as const)

          return result
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              // Emit error event
              yield* PubSub.publish(eventBus, {
                _tag: "AnonymizationError",
                studyId,
                error: error as Error
              } as const)
              return yield* Effect.fail(error)
            })
          )
        )

      // Process all files
      const anonymizedFiles = yield* Effect.all(files.map(processFile), { concurrency, batching: true })

      // Emit completion event
      yield* PubSub.publish(eventBus, {
        _tag: "StudyAnonymized",
        studyId,
        files: anonymizedFiles
      } as const)

      return anonymizedFiles
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

  /**
   * Stream-based anonymization that emits events as a stream
   * This provides natural progress tracking and backpressure control
   */
  static anonymizeStudyStream = (
    studyId: string,
    files: DicomFile[],
    config: AnonymizationConfig,
    options: { concurrency?: number } = {}
  ): Stream.Stream<AnonymizationEvent, AnonymizerError, DicomProcessor | ConfigService> => {
    const { concurrency = 3 } = options
    const total = files.length

    // Generate shared timestamp for consistent replacements
    const sharedTimestamp = Date.now().toString().slice(-7)
    console.log(`[Effect Anonymizer Stream] Using shared timestamp for study ${studyId}: ${sharedTimestamp}`)

    // Create a ref to track completed count
    let completed = 0

    // Start with validation
    const validationStream = Stream.fromEffect(
      AnonymizerImpl.validateConfig(config).pipe(
        Effect.map(() => ({
          _tag: "AnonymizationStarted" as const,
          studyId,
          totalFiles: total
        }))
      )
    )

    // Process files stream
    const filesStream = pipe(
      Stream.fromIterable(files),
      Stream.mapEffect(
        (file) =>
          AnonymizerImpl.anonymizeFile(file, config, sharedTimestamp).pipe(
            Effect.tap(() => Effect.sync(() => {
              completed++
              console.log(`[Effect Anonymizer Stream] Completed file ${completed}/${total}: ${file.fileName}`)
            }))
          ),
        { concurrency }
      ),
      Stream.flatMap((file) =>
        Stream.make(
          {
            _tag: "AnonymizationProgress" as const,
            studyId,
            completed,
            total,
            currentFile: file.fileName
          },
          {
            _tag: "FileAnonymized" as const,
            studyId,
            file
          }
        )
      ),
      Stream.runCollect,
      Stream.fromEffect,
      Stream.flatMap((results) => {
        const anonymizedFiles = Array.from(results).filter(
          (event): event is { _tag: "FileAnonymized"; studyId: string; file: DicomFile } =>
            event._tag === "FileAnonymized"
        ).map(event => event.file)

        console.log(`[Effect Anonymizer Stream] Study ${studyId} anonymization completed: ${anonymizedFiles.length} files processed`)

        return Stream.make({
          _tag: "StudyAnonymized" as const,
          studyId,
          files: anonymizedFiles
        })
      })
    )

    // Combine the streams
    return pipe(
      validationStream,
      Stream.concat(filesStream),
      Stream.catchAll((error) =>
        Stream.make({
          _tag: "AnonymizationError" as const,
          studyId,
          error: error instanceof Error ? error : new Error(String(error))
        })
      )
    )
  }
}

/**
 * Live implementation layer with dependencies
 */
export const AnonymizerLive = Layer.succeed(
  Anonymizer,
  Anonymizer.of({
    anonymizeFile: AnonymizerImpl.anonymizeFile,
    anonymizeFiles: AnonymizerImpl.anonymizeFiles,
    anonymizeStudyWithEvents: AnonymizerImpl.anonymizeStudyWithEvents,
    anonymizeStudy: AnonymizerImpl.anonymizeStudy,
    anonymizeStudyStream: AnonymizerImpl.anonymizeStudyStream,
    validateConfig: AnonymizerImpl.validateConfig
  })
)
