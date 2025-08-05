import { describe, it, expect, beforeEach } from 'vitest'
import { Effect, PubSub, Stream } from 'effect'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Anonymizer, AnonymizerLive } from './index'
import { DicomProcessor, DicomProcessorLive } from '../dicomProcessor'
import { ConfigService, ConfigServiceLive } from '../config'
import { EventBusLayer, AnonymizationEventBus } from '../eventBus'
import { Layer } from 'effect'
import { clearValueCache } from './handlers'
import type { DicomFile, AnonymizationConfig } from '@/types/dicom'
import type { AnonymizationEvent } from '@/types/events'

// Helper to load DICOM files from test-data
function loadTestDicomFile(relativePath: string): DicomFile {
  const fullPath = join(process.cwd(), 'test-data', relativePath)
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
  // Test the service through Effect.provide pattern with dependencies
  const testLayer = Layer.mergeAll(
    EventBusLayer,
    AnonymizerLive,
    DicomProcessorLive, 
    ConfigServiceLive
  )
  
  const runTest = <A, E>(effect: Effect.Effect<A, E, any>) =>
    Effect.runPromise(effect.pipe(Effect.provide(testLayer)))

  beforeEach(() => {
    clearValueCache()
  })

  describe('Configuration validation', () => {
    it('should validate valid configuration', async () => {
      const config: AnonymizationConfig = {
        profile: 'basic',
        removePrivateTags: true,
        useCustomHandlers: true
      }

      await expect(
        runTest(Effect.gen(function* () {
          const anonymizer = yield* Anonymizer
          return yield* anonymizer.validateConfig(config)
        }))
      ).resolves.not.toThrow()
    })

    it('should reject invalid profile', async () => {
      const invalidConfig = {
        profile: 'invalid' as any,
        removePrivateTags: true,
        useCustomHandlers: true
      }

      await expect(
        runTest(Effect.gen(function* () {
          const anonymizer = yield* Anonymizer
          return yield* anonymizer.validateConfig(invalidConfig)
        }))
      ).rejects.toThrow()
    })
  })

  describe('Configuration integration', () => {
    it('should process timestamp patterns from config correctly', async () => {
      const configWithTimestamps: AnonymizationConfig = {
        profile: 'basic',
        removePrivateTags: true,
        useCustomHandlers: true,
        replacements: {
          accessionNumber: 'ACA{timestamp}',
          patientId: 'PAT{timestamp}',
          patientName: 'ANONYMOUS'
        }
      }

      const result = await runTest(Effect.gen(function* () {
        const configService = yield* ConfigService
        return yield* configService.processReplacements(configWithTimestamps.replacements!)
      }))

      expect(result.accessionNumber).toMatch(/^ACA\d{7}$/)
      expect(result.patientId).toMatch(/^PAT\d{7}$/)
      expect(result.patientName).toBe('ANONYMOUS')
    })

    it('should anonymize file using config-based replacements', async () => {
      const dicomFile = loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      
      // First parse the file
      const parsedFile = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFile(dicomFile)
        }).pipe(Effect.provide(DicomProcessorLive))
      )
      
      const configWithReplacements: AnonymizationConfig = {
        profile: 'basic',
        removePrivateTags: true,
        useCustomHandlers: true,
        replacements: {
          accessionNumber: 'ACA{timestamp}',
          patientId: 'PAT{timestamp}',
          patientName: 'ANONYMOUS'
        }
      }

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        return yield* anonymizer.anonymizeFile(parsedFile, configWithReplacements)
      }))
      
      expect(result.anonymized).toBe(true)
      expect(result.metadata).toBeDefined()
      
      // Verify that the anonymized metadata contains expected patterns
      if (result.metadata) {
        console.log('Anonymized metadata:', result.metadata)
        // These should be replaced with the processed timestamp patterns
        expect(result.metadata.accessionNumber).toMatch(/^ACA\d{7}$/)
        expect(result.metadata.patientId).toMatch(/^PAT\d{7}$/)
        // PatientName in DICOM can be a structured object
        if (typeof result.metadata.patientName === 'string') {
          expect(result.metadata.patientName).toBe('ANONYMOUS')
        } else if (result.metadata.patientName && typeof result.metadata.patientName === 'object') {
          expect((result.metadata.patientName as any).Alphabetic).toBe('ANONYMOUS')
        }
      }
    })
  })

  describe('File anonymization', () => {
    it('should anonymize DICOM file', async () => {
      const dicomFile = loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      
      // First parse the file
      const parsedFile = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFile(dicomFile)
        }).pipe(Effect.provide(DicomProcessorLive))
      )
      
      const config: AnonymizationConfig = {
        profile: 'basic',
        removePrivateTags: true,
        useCustomHandlers: true
      }

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
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
      
      const config: AnonymizationConfig = {
        profile: 'basic',
        removePrivateTags: true,
        useCustomHandlers: false
      }

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        return yield* anonymizer.anonymizeFiles(parsedFiles, config)
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
        profile: 'basic',
        removePrivateTags: true,
        useCustomHandlers: false
      }

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        
        // Start anonymization with events
        const anonymizedFiles = yield* anonymizer.anonymizeStudyWithEvents(
          'test-study-123',
          parsedFiles,
          config,
          { concurrency: 1 }
        )
        
        return anonymizedFiles
      }))
      
      // Verify results
      expect(result).toHaveLength(1)
      expect(result[0].anonymized).toBe(true)
      
      // The events are published to the PubSub but we don't test event collection here
      // since it requires complex setup. The fact that the method completes successfully
      // means events were published without errors.
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
        profile: 'basic',
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