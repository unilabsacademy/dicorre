import { Effect, Context, Layer } from "effect"
import * as dcmjs from 'dcmjs'
import type { DicomFile, DicomMetadata, DicomStudy } from '@/types/dicom'
import { ParseError, ValidationError, type DicomProcessorError } from '@/types/effects'
import { ConfigService } from '../config'

export class DicomProcessor extends Context.Tag("DicomProcessor")<
  DicomProcessor,
  {
    readonly parseFile: (file: DicomFile) => Effect.Effect<DicomFile, DicomProcessorError>
    readonly parseFiles: (files: DicomFile[], concurrency?: number) => Effect.Effect<DicomFile[], DicomProcessorError>
    readonly groupFilesByStudy: (files: DicomFile[]) => Effect.Effect<DicomStudy[], DicomProcessorError>
    readonly validateFile: (file: DicomFile) => Effect.Effect<void, ValidationError>
  }
>() {}

/**
 * Internal implementation class
 */
class DicomProcessorImpl {
  /**
   * Effect-based DICOM file validation
   */
  static validateFile = (file: DicomFile): Effect.Effect<void, ValidationError> =>
    Effect.gen(function* () {
      if (!file.arrayBuffer || file.arrayBuffer.byteLength === 0) {
        return yield* Effect.fail(new ValidationError({
          message: `File ${file.fileName} has no data`,
          fileName: file.fileName
        }))
      }

      if (file.arrayBuffer.byteLength < 132) {
        return yield* Effect.fail(new ValidationError({
          message: `File ${file.fileName} is too small to be a valid DICOM file`,
          fileName: file.fileName
        }))
      }

      // Verify DICOM magic number
      const view = new DataView(file.arrayBuffer)
      try {
        const magic = String.fromCharCode(
          view.getUint8(128),
          view.getUint8(129),
          view.getUint8(130),
          view.getUint8(131)
        )

        if (magic !== 'DICM') {
          return yield* Effect.fail(new ValidationError({
            message: `File ${file.fileName} does not have valid DICOM magic number`,
            fileName: file.fileName
          }))
        }
      } catch (error) {
        return yield* Effect.fail(new ValidationError({
          message: `Error reading DICOM magic number in ${file.fileName}`,
          fileName: file.fileName,
          cause: error
        }))
      }
    })

  /**
   * Effect-based DICOM file parsing
   */
  static parseFile = (file: DicomFile): Effect.Effect<DicomFile, DicomProcessorError> =>
    Effect.gen(function* () {
      // Validate the file first
      yield* DicomProcessorImpl.validateFile(file)

      const result = yield* Effect.try({
        try: () => {
          console.log(`Parsing DICOM file: ${file.fileName}`)
          
          // Parse with dcmjs
          const dataset = dcmjs.data.DicomMessage.readFile(file.arrayBuffer)
          const dict = dataset.dict

          // Extract metadata
          const metadata: DicomMetadata = {
            patientName: dict['00100010']?.Value?.[0] || 'Unknown',
            patientId: dict['00100020']?.Value?.[0] || 'Unknown',
            patientBirthDate: dict['00100030']?.Value?.[0] || '',
            studyInstanceUID: dict['0020000D']?.Value?.[0] || '',
            studyDate: dict['00080020']?.Value?.[0] || '',
            studyDescription: dict['00081030']?.Value?.[0] || '',
            seriesInstanceUID: dict['0020000E']?.Value?.[0] || '',
            seriesDescription: dict['0008103E']?.Value?.[0] || '',
            modality: dict['00080060']?.Value?.[0] || 'Unknown',
            sopInstanceUID: dict['00080018']?.Value?.[0] || '',
            instanceNumber: dict['00200013']?.Value?.[0] || 1,
            transferSyntaxUID: dict['00020010']?.Value?.[0] || '1.2.840.10008.1.2'
          }

          console.log(`Successfully parsed ${file.fileName}: Patient ${metadata.patientId}, Study ${metadata.studyInstanceUID}`)

          return {
            ...file,
            metadata,
            parsed: true
          }
        },
        catch: (error) => new ParseError({
          message: `Failed to parse DICOM file: ${file.fileName}`,
          fileName: file.fileName,
          cause: error
        })
      })

      return result
    })

  /**
   * Parse multiple files concurrently
   */
  static parseFiles = (files: DicomFile[], concurrency = 3): Effect.Effect<DicomFile[], DicomProcessorError> =>
    Effect.gen(function* () {
      if (files.length === 0) {
        return []
      }

      console.log(`Starting to parse ${files.length} DICOM files with concurrency ${concurrency}`)

      const results = yield* Effect.all(
        files.map(file => DicomProcessorImpl.parseFile(file)),
        { concurrency, batching: true }
      )

      const successfulResults = results.filter(file => file.parsed)
      console.log(`Successfully parsed ${successfulResults.length}/${files.length} DICOM files`)

      return successfulResults
    })

  /**
   * Group files by patient/study/series
   */
  static groupFilesByStudy = (files: DicomFile[]): Effect.Effect<DicomStudy[], DicomProcessorError> =>
    Effect.gen(function* () {
      const studyMap = new Map<string, DicomStudy>()
      
      for (const file of files) {
        if (!file.metadata) {
          console.warn(`File ${file.fileName} has no metadata, skipping`)
          continue
        }
        
        const {
          patientId,
          patientName,
          studyInstanceUID,
          studyDate,
          studyDescription,
          seriesInstanceUID,
          seriesDescription,
          modality
        } = file.metadata
        
        // Create study key that includes both patient and study info
        const studyKey = `${patientId}|${studyInstanceUID}`
        
        // Get or create study
        if (!studyMap.has(studyKey)) {
          studyMap.set(studyKey, {
            studyInstanceUID,
            patientName: patientName || 'Unknown',
            patientId: patientId || 'Unknown',
            studyDate: studyDate || new Date().toISOString().split('T')[0].replace(/-/g, ''),
            studyDescription: studyDescription || 'Unknown Study',
            series: []
          })
        }
        
        const study = studyMap.get(studyKey)!
        
        // Find or create series
        let series = study.series.find(s => s.seriesInstanceUID === seriesInstanceUID)
        if (!series) {
          series = {
            seriesInstanceUID,
            seriesDescription: seriesDescription || 'Unknown Series',
            modality: modality || 'Unknown',
            files: []
          }
          study.series.push(series)
        }
        
        // Add file to series
        series.files.push(file)
      }
      
      // Convert map to array and sort
      const studies = Array.from(studyMap.values())
      
      // Sort studies by patient ID and study date
      studies.sort((a, b) => {
        const patientCompare = a.patientId.localeCompare(b.patientId)
        if (patientCompare !== 0) return patientCompare
        return a.studyDate.localeCompare(b.studyDate)
      })
      
      // Sort series within each study
      studies.forEach(study => {
        study.series.sort((a, b) => a.seriesInstanceUID.localeCompare(b.seriesInstanceUID))
      })
      
      return studies
    })
}

/**
 * Live implementation layer with ConfigService dependency
 */
export const DicomProcessorLive = Layer.succeed(
  DicomProcessor,
  DicomProcessor.of({
    parseFile: DicomProcessorImpl.parseFile,
    parseFiles: DicomProcessorImpl.parseFiles,
    groupFilesByStudy: DicomProcessorImpl.groupFilesByStudy,
    validateFile: DicomProcessorImpl.validateFile
  })
)