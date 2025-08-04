import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { readFileSync } from 'fs'
import { join } from 'path'
import { DicomProcessor, DicomProcessorLive } from './index'
import type { DicomFile } from '@/types/dicom'

// Helper to load DICOM files from test-data
function loadTestDicomFile(relativePath: string): DicomFile {
  const fullPath = join(process.cwd(), 'test-data', relativePath)
  const buffer = readFileSync(fullPath)
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  
  return {
    id: `test-${Date.now()}`,
    fileName: relativePath.split('/').pop() || 'unknown.dcm',
    fileSize: arrayBuffer.byteLength,
    arrayBuffer,
    anonymized: false
  }
}

describe('DicomProcessor Service (Effect Service Testing)', () => {
  // Test the service through Effect.provide pattern
  const runTest = <A, E>(effect: Effect.Effect<A, E, DicomProcessor>) =>
    Effect.runPromise(effect.pipe(Effect.provide(DicomProcessorLive)))

  describe('DICOM parsing', () => {
    it('should parse valid DICOM file', async () => {
      const dicomFile = loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      
      const result = await runTest(Effect.gen(function* () {
        const processor = yield* DicomProcessor
        return yield* processor.parseFile(dicomFile)
      }))
      
      expect(result.metadata).toBeDefined()
      expect(result.metadata?.studyInstanceUID).toBeDefined()
      expect(result.parsed).toBe(true)
    })

    it('should parse multiple files concurrently', async () => {
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC'),
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0EEC66')
      ]
      
      const result = await runTest(Effect.gen(function* () {
        const processor = yield* DicomProcessor
        return yield* processor.parseFiles(files, 2)
      }))
      
      expect(result).toHaveLength(2)
      expect(result[0].metadata).toBeDefined()
    })

    it('should handle empty file list', async () => {
      const result = await runTest(Effect.gen(function* () {
        const processor = yield* DicomProcessor
        return yield* processor.parseFiles([])
      }))
      
      expect(result).toHaveLength(0)
    })
  })

  describe('File validation', () => {
    it('should validate valid DICOM file', async () => {
      const dicomFile = loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      
      await expect(
        runTest(Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.validateFile(dicomFile)
        }))
      ).resolves.not.toThrow()
    })

    it('should reject invalid DICOM files', async () => {
      const invalidFile: DicomFile = {
        id: 'invalid-test',
        fileName: 'invalid.dcm',
        fileSize: 50,
        arrayBuffer: new ArrayBuffer(50),
        anonymized: false
      }

      await expect(
        runTest(Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.validateFile(invalidFile)
        }))
      ).rejects.toThrow()
    })
  })

  describe('File grouping', () => {
    it('should group files by study', async () => {
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      ]
      
      const result = await runTest(Effect.gen(function* () {
        const processor = yield* DicomProcessor
        const parsedFiles = yield* processor.parseFiles(files)
        return yield* processor.groupFilesByStudy(parsedFiles)
      }))
      
      expect(result).toHaveLength(1)
      expect(result[0].series).toBeDefined()
    })

    it('should correctly group 3 cases with 3 series each (18 files total)', async () => {
      // Load test ZIP file containing 3 cases x 3 series x 2 images each
      const { readFileSync } = await import('fs')
      const { FileHandler, FileHandlerLive } = await import('@/services/fileHandler')
      
      const runFileHandlerTest = <A, E>(effect: Effect.Effect<A, E, FileHandler>) =>
        Effect.runPromise(effect.pipe(Effect.provide(FileHandlerLive)))
      
      const zipPath = join(process.cwd(), 'test-data/CASES/3_cases_each_with_3_series_6_images.zip')
      const zipFile = new File([readFileSync(zipPath)], '3_cases_each_with_3_series_6_images.zip')
      
      // Extract and parse DICOM files
      const extractedFiles = await runFileHandlerTest(Effect.gen(function* () {
        const fileHandler = yield* FileHandler
        return yield* fileHandler.extractZipFile(zipFile)
      }))
      expect(extractedFiles.length).toBe(18)
      
      const result = await runTest(Effect.gen(function* () {
        const processor = yield* DicomProcessor
        const parsedFiles = yield* processor.parseFiles(extractedFiles, 3)
        const studies = yield* processor.groupFilesByStudy(parsedFiles)
        return studies
      }))
      
      // Validate grouping results
      expect(result.length).toBe(3) // 3 studies (1 per patient)
      
      // Count total series and files
      let totalSeries = 0
      let totalFiles = 0
      const patientIds = new Set<string>()
      
      for (const study of result) {
        patientIds.add(study.patientId)
        totalSeries += study.series.length
        expect(study.series.length).toBe(3) // Each study should have 3 series
        
        for (const series of study.series) {
          totalFiles += series.files.length
          expect(series.files.length).toBe(2) // Each series should have 2 files
          
          // All files in the series should have the same series UID
          const firstSeriesUID = series.files[0].metadata?.seriesInstanceUID
          series.files.forEach(file => {
            expect(file.metadata?.seriesInstanceUID).toBe(firstSeriesUID)
          })
        }
      }
      
      expect(patientIds.size).toBe(3) // 3 different patients
      expect(totalSeries).toBe(9) // 9 series total (3 per study)
      expect(totalFiles).toBe(18) // 18 files total
    })

    it('should correctly group 1 case with 3 series (6 files total)', async () => {
      // Load test ZIP file containing 1 case with 3 series x 2 images each
      const { readFileSync } = await import('fs')
      const { FileHandler, FileHandlerLive } = await import('@/services/fileHandler')
      
      const runFileHandlerTest = <A, E>(effect: Effect.Effect<A, E, FileHandler>) =>
        Effect.runPromise(effect.pipe(Effect.provide(FileHandlerLive)))
      
      const zipPath = join(process.cwd(), 'test-data/CASES/1_case_3_series_6_images.zip')
      const zipFile = new File([readFileSync(zipPath)], '1_case_3_series_6_images.zip')
      
      // Extract and parse DICOM files
      const extractedFiles = await runFileHandlerTest(Effect.gen(function* () {
        const fileHandler = yield* FileHandler
        return yield* fileHandler.extractZipFile(zipFile)
      }))
      expect(extractedFiles.length).toBe(6)
      
      const result = await runTest(Effect.gen(function* () {
        const processor = yield* DicomProcessor
        const parsedFiles = yield* processor.parseFiles(extractedFiles)
        const studies = yield* processor.groupFilesByStudy(parsedFiles)
        return studies
      }))
      
      // Validate grouping results
      expect(result.length).toBe(1) // 1 study
      
      const study = result[0]
      expect(study.series.length).toBe(3) // 3 series
      
      let totalFiles = 0
      for (const series of study.series) {
        totalFiles += series.files.length
        expect(series.files.length).toBe(2) // Each series should have 2 files
      }
      
      expect(totalFiles).toBe(6) // 6 files total
    })

    it('should handle files with missing metadata gracefully', async () => {
      const filesWithMissingMetadata: DicomFile[] = [
        {
          id: '1',
          fileName: 'valid.dcm',
          fileSize: 1000,
          arrayBuffer: new ArrayBuffer(1000),
          anonymized: false,
          parsed: true,
          metadata: {
            accessionNumber: 'ACC1',
            patientId: 'PAT1',
            patientName: 'Patient One',
            patientBirthDate: '',
            patientSex: '',
            patientWeight: 0,
            patientHeight: 0,
            studyInstanceUID: 'STUDY1',
            studyDate: '20241201',
            studyDescription: 'Test Study',
            seriesInstanceUID: 'SERIES1',
            seriesDescription: 'Test Series',
            modality: 'CT',
            sopInstanceUID: 'SOP1',
            instanceNumber: 1,
            transferSyntaxUID: '1.2.840.10008.1.2'
          }
        },
        {
          id: '2',
          fileName: 'invalid.dcm',
          fileSize: 500,
          arrayBuffer: new ArrayBuffer(500),
          anonymized: false,
          parsed: false
          // No metadata
        }
      ]
      
      const result = await runTest(Effect.gen(function* () {
        const processor = yield* DicomProcessor
        return yield* processor.groupFilesByStudy(filesWithMissingMetadata)
      }))
      
      // Should only process the file with valid metadata
      expect(result.length).toBe(1)
      expect(result[0].series.length).toBe(1)
      expect(result[0].series[0].files.length).toBe(1)
    })
  })
})