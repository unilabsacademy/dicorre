import { Effect, Context, Layer } from "effect"
import {
  DicomDeidentifier,
  BasicProfile,
  CleanDescOption,
  CleanGraphOption,
  RetainLongModifDatesOption,
  RetainLongFullDatesOption,
  RetainUIDsOption,
  RetainPatientCharsOption,
  RetainSafePrivateOption,
  RetainDeviceIdentOption,
  RetainInstIdentOption,
  CleanStructContOption,
  type DeidentifyOptions,
  type ProfileOption
} from '@umessen/dicom-deidentifier'
import type { DicomFile, DicomFieldOverrides, DicomMetadata } from '@/types/dicom'
import { DicomProcessor } from '../dicomProcessor'
import type { AnonymizationConfig } from '../config/schema'
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
    readonly anonymizeFile: (file: DicomFile, config: AnonymizationConfig, sharedRandom?: string, fieldOverrides?: DicomFieldOverrides, patientIdMap?: Record<string, string>) => Effect.Effect<DicomFile, AnonymizerError>
    readonly anonymizeStudy: (studyId: string, files: DicomFile[], config: AnonymizationConfig, options?: { concurrency?: number; onProgress?: (progress: AnonymizationProgress) => void; fieldOverrides?: DicomFieldOverrides; patientIdMap?: Record<string, string> }) => Effect.Effect<StudyAnonymizationResult, AnonymizerError>
  }
>() { }

export const AnonymizerLive = Layer.effect(
  Anonymizer,
  Effect.gen(function* () {
    const dicomProcessor = yield* DicomProcessor

    const generateRandomString = (): string => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
      let result = ''
      for (let i = 0; i < 7; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      return result
    }

    const processReplacements = (replacements: Record<string, string>, sharedRandom?: string): Record<string, string> => {
      const processed: Record<string, string> = {}
      const randomString = sharedRandom || generateRandomString()

      for (const [key, value] of Object.entries(replacements)) {
        // Convert tag names to hex using the tag() helper, leave other keys as-is
        const processedKey = key === 'default' ? key : tag(key)
        processed[processedKey] = value.replace('{random}', randomString)
      }

      return processed
    }

    const getFieldValueFromMetadata = (metadata: DicomMetadata | undefined, fieldName: string): string | undefined => {
      if (!metadata) return undefined
      
      // Map common field names to metadata properties
      const fieldMap: Record<string, keyof DicomMetadata> = {
        'Patient ID': 'patientId',
        'PatientID': 'patientId',
        "Patient's Name": 'patientName',
        'PatientName': 'patientName',
        'Study Date': 'studyDate',
        'StudyDate': 'studyDate',
        "Patient's Sex": 'patientSex',
        'PatientSex': 'patientSex',
        "Patient's Birth Date": 'patientBirthDate',
        'PatientBirthDate': 'patientBirthDate',
        'Accession Number': 'accessionNumber',
        'AccessionNumber': 'accessionNumber',
        'Study Description': 'studyDescription',
        'StudyDescription': 'studyDescription',
        'Series Description': 'seriesDescription',
        'SeriesDescription': 'seriesDescription',
        'Modality': 'modality'
      }
      
      const metadataKey = fieldMap[fieldName]
      if (metadataKey) {
        const value = metadata[metadataKey]
        return value?.toString()
      }
      
      return undefined
    }

    const anonymizeFile = (file: DicomFile, config: AnonymizationConfig, sharedRandom?: string, fieldOverrides?: DicomFieldOverrides, patientIdMap?: Record<string, string>): Effect.Effect<DicomFile, AnonymizerError> =>
      Effect.gen(function* () {
        // Check if file has metadata
        if (!file.metadata) {
          return yield* Effect.fail(new AnonymizationError({
            message: `File ${file.fileName} has no metadata - cannot anonymize`,
            fileName: file.fileName
          }))
        }

        console.log(`Starting anonymization of file: ${file.fileName}`)

        // Process replacements with optional shared random string
        console.log('Processing replacements from config:', config.replacements)
        const processedReplacements = processReplacements(
          config.replacements || {},
          sharedRandom
        )
        console.log('Processed replacements result:', processedReplacements)

        // Apply field overrides if provided
        if (fieldOverrides) {
          for (const [fieldName, value] of Object.entries(fieldOverrides)) {
            const fieldTag = tag(fieldName)
            if (typeof value === 'string') {
              // Direct assignment
              processedReplacements[fieldTag] = value
              console.log(`Overriding ${fieldName} (${fieldTag}) with direct value: ${value}`)
            } else if (typeof value === 'object' && value !== null) {
              // Mapping mode - use current file's value to look up replacement
              const currentValue = getFieldValueFromMetadata(file.metadata, fieldName)
              if (currentValue && value[currentValue]) {
                processedReplacements[fieldTag] = value[currentValue]
                console.log(`Overriding ${fieldName} (${fieldTag}) using mapping: ${currentValue} -> ${value[currentValue]}`)
              }
            }
          }
        }

        // Backward compatibility: If a patientIdMap is provided, apply it
        const originalPatientId = file.metadata?.patientId
        if (patientIdMap && originalPatientId) {
          const assignedId = patientIdMap[originalPatientId]
          if (assignedId) {
            processedReplacements[tag('Patient ID')] = assignedId
            console.log(`Overriding Patient ID replacement using mapping for ${file.fileName}: ${originalPatientId} -> ${assignedId}`)
          }
        }

        // Map string profile options to actual profile objects
        const profileOptions: ProfileOption[] = (config.profileOptions || ['BasicProfile']).map(option => {
          switch (option) {
            case 'BasicProfile':
              return BasicProfile
            case 'RetainLongModifDatesOption':
              return RetainLongModifDatesOption
            case 'RetainLongFullDatesOption':
              return RetainLongFullDatesOption
            case 'RetainUIDsOption':
              return RetainUIDsOption
            case 'CleanGraphOption':
              return CleanGraphOption
            case 'RetainPatientCharsOption':
              return RetainPatientCharsOption
            case 'RetainSafePrivateOption':
              return RetainSafePrivateOption
            case 'CleanDescOption':
              return CleanDescOption
            case 'RetainDeviceIdentOption':
              return RetainDeviceIdentOption
            case 'RetainInstIdentOption':
              return RetainInstIdentOption
            case 'CleanStructContOption':
              return CleanStructContOption
            default:
              return BasicProfile
          }
        })

        // Configure deidentifier options
        const deidentifierConfig: DeidentifyOptions = {
          profileOptions,
          dummies: {
            default: processedReplacements.default || 'REMOVED',
            lookup: processedReplacements
          },
          keep: config.preserveTags ? [...config.preserveTags] : undefined,
          getReferenceDate: getDicomReferenceDate,
          getReferenceTime: getDicomReferenceTime
        }

        // Add custom special handlers if enabled
        if (config.useCustomHandlers) {
          const tagsToRemove = config.tagsToRemove ? [...config.tagsToRemove] : []
          // For individual files, use the Study Instance UID as the cache key
          const studyId = file.metadata?.studyInstanceUID || 'unknown'
          // If a patientIdMap is provided, disable PatientID generation in handlers to prevent conflicts
          const disablePatientId = !!patientIdMap || (fieldOverrides && ('Patient ID' in fieldOverrides || 'PatientID' in fieldOverrides))
          // Pass the processed replacements to handlers as fieldOverrides
          const specialHandlers = getAllSpecialHandlers(config.dateJitterDays || 31, tagsToRemove, studyId, { 
            disablePatientId,
            fieldOverrides: processedReplacements
          })
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

    const anonymizeStudy = (
      studyId: string,
      files: DicomFile[],
      config: AnonymizationConfig,
      options: { concurrency?: number; onProgress?: (progress: AnonymizationProgress) => void; fieldOverrides?: DicomFieldOverrides; patientIdMap?: Record<string, string> } = {}
    ): Effect.Effect<StudyAnonymizationResult, AnonymizerError> =>
      Effect.gen(function* () {
        const { concurrency = 3, onProgress, fieldOverrides } = options
        const patientIdMap = options.patientIdMap

        console.log(`[Effect Anonymizer] Starting anonymization of study ${studyId} with ${files.length} files`)

        // Generate shared random string for consistent replacements across all files in this study
        const sharedRandom = generateRandomString()
        console.log(`[Effect Anonymizer] Using shared random string for study ${studyId}: ${sharedRandom}`)

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

            // Anonymize individual file with shared random string
            const result = yield* anonymizeFile(file, config, sharedRandom, fieldOverrides, patientIdMap)

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

    return {
      anonymizeFile,
      anonymizeStudy
    } as const
  })
)
