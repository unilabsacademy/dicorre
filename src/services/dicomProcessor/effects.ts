/**
 * Effect-based DICOM processor service
 */

import { Effect, Context, Layer } from "effect"
import * as dcmjs from 'dcmjs'
import type { DicomFile, DicomMetadata } from "@/types/dicom"
import { ParseError, ValidationError, type DicomProcessorError } from "@/types/effects"

// Define the DicomProcessor service interface
export interface DicomProcessorService {
  readonly parseDicomFile: (file: DicomFile) => Effect.Effect<DicomFile, DicomProcessorError>
  readonly validateDicomFile: (file: DicomFile) => Effect.Effect<DicomMetadata, DicomProcessorError>
  readonly extractMetadata: (arrayBuffer: ArrayBuffer) => Effect.Effect<DicomMetadata, DicomProcessorError>
}

// Create the service tag for dependency injection
export const DicomProcessorService = Context.GenericTag<DicomProcessorService>("DicomProcessorService")

// Helper function to parse DICOM file directly
const parseDicomFileSync = (file: DicomFile): DicomFile => {
  // Check if ArrayBuffer has proper DICOM structure
  if (file.arrayBuffer.byteLength < 132) {
    throw new Error('File too small to be a valid DICOM file')
  }

  // Verify DICOM magic number
  const view = new DataView(file.arrayBuffer)
  const magic = String.fromCharCode(
    view.getUint8(128),
    view.getUint8(129),
    view.getUint8(130),
    view.getUint8(131)
  )
  
  if (magic !== 'DICM') {
    console.warn(`File ${file.fileName} missing DICM header, attempting to parse anyway`)
  }

  const dicomData = dcmjs.data.DicomMessage.readFile(file.arrayBuffer)
  const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict)
  
  const metadata: DicomMetadata = {
    patientName: dataset.PatientName?.Alphabetic || 'Unknown',
    patientId: dataset.PatientID || 'Unknown',
    studyInstanceUID: dataset.StudyInstanceUID,
    studyDate: dataset.StudyDate,
    studyDescription: dataset.StudyDescription || '',
    seriesInstanceUID: dataset.SeriesInstanceUID,
    seriesDescription: dataset.SeriesDescription || '',
    modality: dataset.Modality || '',
    sopInstanceUID: dataset.SOPInstanceUID
  }

  return {
    ...file,
    metadata
  }
}

// Implementation of the DicomProcessor service
const makeDicomProcessorService = (): DicomProcessorService => {
  return {
    parseDicomFile: (file: DicomFile) =>
      Effect.try({
        try: () => parseDicomFileSync(file),
        catch: (error) => new ParseError({
          message: `Failed to parse DICOM file: ${file.fileName}`,
          fileName: file.fileName,
          cause: error
        })
      }),

    validateDicomFile: (file: DicomFile) =>
      Effect.gen(function* (_) {
        // First parse the file
        const parsedFile = yield* _(
          Effect.try({
            try: () => parseDicomFileSync(file),
            catch: (error) => new ParseError({
              message: `Failed to parse DICOM file for validation: ${file.fileName}`,
              fileName: file.fileName,
              cause: error
            })
          })
        )

        // Validate that metadata exists
        if (!parsedFile.metadata) {
          return yield* _(Effect.fail(new ValidationError({
            message: `DICOM file has no metadata: ${file.fileName}`,
            field: "metadata"
          })))
        }

        return parsedFile.metadata
      }),

    extractMetadata: (arrayBuffer: ArrayBuffer) =>
      Effect.try({
        try: () => {
          const dicomData = dcmjs.data.DicomMessage.readFile(arrayBuffer)
          const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict)
          
          return {
            patientName: dataset.PatientName?.Alphabetic || 'Unknown',
            patientId: dataset.PatientID || 'Unknown',
            studyInstanceUID: dataset.StudyInstanceUID,
            studyDate: dataset.StudyDate,
            studyDescription: dataset.StudyDescription || '',
            seriesInstanceUID: dataset.SeriesInstanceUID,  
            seriesDescription: dataset.SeriesDescription || '',
            modality: dataset.Modality || '',
            sopInstanceUID: dataset.SOPInstanceUID
          }
        },
        catch: (error) => new ParseError({
          message: "Failed to extract metadata from ArrayBuffer",
          cause: error
        })
      })
  }
}

// Create the service layer for dependency injection
export const DicomProcessorServiceLive = Layer.succeed(
  DicomProcessorService,
  makeDicomProcessorService()
)

// Convenience functions for using the service
export const parseDicomFile = (file: DicomFile) =>
  Effect.gen(function* (_) {
    const service = yield* _(DicomProcessorService)
    return yield* _(service.parseDicomFile(file))
  })

export const validateDicomFile = (file: DicomFile) =>
  Effect.gen(function* (_) {
    const service = yield* _(DicomProcessorService)
    return yield* _(service.validateDicomFile(file))
  })

export const extractMetadata = (arrayBuffer: ArrayBuffer) =>
  Effect.gen(function* (_) {
    const service = yield* _(DicomProcessorService)
    return yield* _(service.extractMetadata(arrayBuffer))
  })