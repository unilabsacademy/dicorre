import { describe, it, expect, beforeEach } from 'vitest'
import { Effect } from 'effect'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Anonymizer, AnonymizerLive } from './index'
import { DicomProcessor, DicomProcessorLive } from '../dicomProcessor'
import { Layer } from 'effect'
import { clearValueCache } from './handlers'
import type { DicomFile } from '@/types/dicom'
import { TestConfigLayer } from '../shared/test-layers'
import { ConfigService } from '../config'
import type { AnonymizationConfig } from '@/services/config/schema'

// Helper to load DICOM files from test-data
function loadTestDicomFile(relativePath: string): DicomFile {
  const fullPath = join(process.cwd(), 'test-data', relativePath)
  console.log(fullPath)
  const buffer = readFileSync(fullPath)
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

  return {
    id: `effect-test-${Date.now()}`,
    fileName: relativePath.split('/').pop() || 'unknown.dcm',
    fileSize: arrayBuffer.byteLength,
    arrayBuffer,
    anonymized: false
  }
}

describe('Anonymizer Service (Effect Service Testing)', () => {
  // AnonymizerLive requires DicomProcessor and ConfigService, so we compose them properly
  const testLayer = Layer.mergeAll(
    DicomProcessorLive,
    TestConfigLayer,
    AnonymizerLive.pipe(Layer.provide(Layer.mergeAll(DicomProcessorLive, TestConfigLayer)))
  )

  const runTest = <A, E>(effect: Effect.Effect<A, E, Anonymizer | DicomProcessor | ConfigService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(testLayer)))

  beforeEach(() => {
    clearValueCache()
  })

  describe('Configuration integration', () => {
    it('should anonymize file using config-based replacements', async () => {
      const dicomFile = loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      console.log(dicomFile)

      // First parse the file using the test layer
      const parsedFile = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFile(dicomFile)
        }).pipe(Effect.provide(testLayer))
      )

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const configService = yield* ConfigService
        const config = yield* configService.getAnonymizationConfig
        return yield* anonymizer.anonymizeFile(parsedFile, config)
      }))

      expect(result.anonymized).toBe(true)
      expect(result.metadata).toBeDefined()

      // Verify that the anonymized metadata contains expected patterns from test config
      if (result.metadata) {
        console.log('Anonymized metadata:', result.metadata)
        // These should be replaced with the processed random patterns (7 uppercase alphanumeric chars)
        expect(result.metadata.accessionNumber).toMatch(/^ACA[A-Z0-9]{7}$/)
        expect(result.metadata.patientId).toMatch(/^PAT[A-Z0-9]{7}$/)
        // PatientName should use default "REMOVED" since it's not in replacements
        // PatientName in DICOM can be a structured object
        if (typeof result.metadata.patientName === 'string') {
          expect(result.metadata.patientName).toBe('REMOVED')
        } else if (result.metadata.patientName && typeof result.metadata.patientName === 'object') {
          expect((result.metadata.patientName as any).Alphabetic).toBe('REMOVED')
        }
      }
    })
  })

  describe('File anonymization', () => {
    it('should anonymize DICOM file', async () => {
      const dicomFile = loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')

      // First parse the file using the test layer
      const parsedFile = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFile(dicomFile)
        }).pipe(Effect.provide(testLayer))
      )

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const configService = yield* ConfigService
        const config = yield* configService.getAnonymizationConfig
        return yield* anonymizer.anonymizeFile(parsedFile, config)
      }))

      expect(result.anonymized).toBe(true)
      expect(result.arrayBuffer).toBeDefined()
    })

    it('should anonymize multiple files', async () => {
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      ]

      // Parse files first
      const parsedFiles = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFiles(files)
        }).pipe(Effect.provide(DicomProcessorLive))
      )

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const configService = yield* ConfigService
        const config = yield* configService.getAnonymizationConfig
        const studyResult = yield* anonymizer.anonymizeStudy('test-study', parsedFiles, config)
        return studyResult.anonymizedFiles
      }))

      expect(result).toHaveLength(1)
      expect(result[0].anonymized).toBe(true)
    })

    it('should anonymize study with events', async () => {
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      ]

      // Parse files first
      const parsedFiles = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFiles(files)
        }).pipe(Effect.provide(DicomProcessorLive))
      )

      const config: AnonymizationConfig = {
        profileOptions: ['BasicProfile'],
        removePrivateTags: true,
        useCustomHandlers: false
      }

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer

        // Start anonymization with progress callback
        let progressCalled = false
        const studyResult = yield* anonymizer.anonymizeStudy(
          'test-study-123',
          parsedFiles,
          config,
          {
            concurrency: 1,
            onProgress: () => { progressCalled = true }
          }
        )

        return { files: studyResult.anonymizedFiles, progressCalled }
      }))

      // Verify results
      expect(result.files).toHaveLength(1)
      expect(result.files[0].anonymized).toBe(true)
      expect(result.progressCalled).toBe(true)
    })
  })

  describe('Study anonymization', () => {
    it('should handle empty file list', async () => {
      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer

        const configService = yield* ConfigService
        const config = yield* configService.getAnonymizationConfig
        return yield* anonymizer.anonymizeStudy(
          'test-study-empty',
          [],
          config,
          { concurrency: 1 }
        )
      }))

      expect(result.studyId).toBe('test-study-empty')
      expect(result.totalFiles).toBe(0)
      expect(result.anonymizedFiles).toHaveLength(0)
    })

    it('should handle concurrent file processing', async () => {
      // Create multiple test files
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC'),
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC'),
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      ].map((file, index) => ({ ...file, id: `file-${index}` }))

      // Parse files first
      const parsedFiles = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFiles(files)
        }).pipe(Effect.provide(DicomProcessorLive))
      )

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const configService = yield* ConfigService
        const config = yield* configService.getAnonymizationConfig

        return yield* anonymizer.anonymizeStudy(
          'test-study-concurrent',
          parsedFiles,
          config,
          { concurrency: 3 } // Process all files concurrently
        )
      }))

      // Verify all files were processed
      expect(result.studyId).toBe('test-study-concurrent')
      expect(result.totalFiles).toBe(3)
      expect(result.anonymizedFiles).toHaveLength(3)

      // All files should be anonymized
      result.anonymizedFiles.forEach(file => {
        expect(file.anonymized).toBe(true)
      })
    })

    it('respects provided patientIdMap and keeps same assigned ID for same original IDs', async () => {
      // Load two files that will share the same original patientId after parsing
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC'),
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC'),
      ]

      const parsedFiles = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFiles(files)
        }).pipe(Effect.provide(DicomProcessorLive))
      )

      // Build patientIdMap using parsed metadata patientId
      const originalId = parsedFiles[0].metadata?.patientId || 'Unknown'
      const patientIdMap: Record<string, string> = { [originalId]: 'PATFIXED123' }

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const configService = yield* ConfigService
        const config = yield* configService.getAnonymizationConfig

        return yield* anonymizer.anonymizeStudy(
          'test-study-mapping',
          parsedFiles,
          config,
          { concurrency: 2, patientIdMap }
        )
      }))

      expect(result.anonymizedFiles.length).toBe(2)
      const ids = result.anonymizedFiles.map(f => f.metadata?.patientId)
      expect(ids.every(id => id === 'PATFIXED123')).toBe(true)
    })
  })

  describe('Error handling', () => {
    it('should reject files without metadata', async () => {
      const fileWithoutMetadata: DicomFile = {
        id: 'test-no-metadata',
        fileName: 'invalid.dcm',
        fileSize: 100,
        arrayBuffer: new ArrayBuffer(100),
        anonymized: false
        // No metadata
      }

      const config: AnonymizationConfig = {
        profileOptions: ['BasicProfile'],
        removePrivateTags: true,
        useCustomHandlers: true
      }

      await expect(
        runTest(Effect.gen(function* () {
          const anonymizer = yield* Anonymizer
          return yield* anonymizer.anonymizeFile(fileWithoutMetadata, config)
        }))
      ).rejects.toThrow()
    })
  })
})
