import { describe, it, expect, beforeEach } from 'vitest'
import { Effect } from 'effect'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Anonymizer, AnonymizerLive } from './index'
import { DicomProcessor, DicomProcessorLive } from '../dicomProcessor'
import { ConfigService, ConfigServiceLive } from '../config'
import { Layer } from 'effect'
import { clearValueCache } from './handlers'
import type { DicomFile, AnonymizationConfig } from '@/types/dicom'

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
    AnonymizerLive,
    DicomProcessorLive, 
    ConfigServiceLive
  )
  
  const runTest = <A, E>(effect: Effect.Effect<A, E, Anonymizer | DicomProcessor | ConfigService>) =>
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