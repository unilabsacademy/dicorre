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
  })
})