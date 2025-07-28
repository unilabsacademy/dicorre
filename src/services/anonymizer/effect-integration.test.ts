import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Anonymizer } from './index'
import { clearValueCache } from './handlers'
import type { DicomFile, AnonymizationConfig } from '@/types/dicom'
import { DicomProcessor } from '../dicomProcessor'

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

describe('Effect-based Anonymizer Integration Tests', () => {
  let anonymizer: Anonymizer
  let dicomProcessor: DicomProcessor

  beforeEach(() => {
    anonymizer = new Anonymizer()
    dicomProcessor = new DicomProcessor()
    clearValueCache()
  })

  describe('Effect-based methods', () => {
    it('should anonymize using Effect-based method', async () => {
      const dicomFile = loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      const parsedFile = dicomProcessor.parseDicomFile(dicomFile)
      
      const config: AnonymizationConfig = {
        profile: 'basic',
        removePrivateTags: true,
        useCustomHandlers: true,
        dateJitterDays: 31
      }

      // Test the Effect-based method
      const anonymizedFile = await anonymizer.anonymizeFileWithEffect(parsedFile, config)
      
      expect(anonymizedFile.anonymized).toBe(true)
      expect(anonymizedFile.arrayBuffer).toBeDefined()
      expect(anonymizedFile.arrayBuffer.byteLength).toBeGreaterThan(0)
      
      // Should be parseable
      const reparsedFile = dicomProcessor.parseDicomFile(anonymizedFile)
      expect(reparsedFile.metadata).toBeDefined()
    })

    it('should anonymize multiple files concurrently with progress', async () => {
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC'),
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0EEC66')
      ]
      
      const parsedFiles = files.map(file => dicomProcessor.parseDicomFile(file))
      
      const config: AnonymizationConfig = {
        profile: 'basic',
        removePrivateTags: true,
        useCustomHandlers: true
      }

      const progressUpdates: any[] = []
      
      // Test concurrent processing with progress tracking
      const anonymizedFiles = await anonymizer.anonymizeFilesConcurrently(
        parsedFiles,
        config,
        {
          concurrency: 2,
          onProgress: (progress) => {
            progressUpdates.push(progress)
          }
        }
      )
      
      expect(anonymizedFiles).toHaveLength(2)
      expect(anonymizedFiles[0].anonymized).toBe(true)
      expect(anonymizedFiles[1].anonymized).toBe(true)
      
      // Should have received progress updates
      expect(progressUpdates.length).toBeGreaterThan(0)
      expect(progressUpdates.some(p => p.percentage === 100)).toBe(true)
    })

    it('should anonymize files in batches', async () => {
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC'),
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0EEC66')
      ]
      
      const parsedFiles = files.map(file => dicomProcessor.parseDicomFile(file))
      
      const config: AnonymizationConfig = {
        profile: 'basic',
        removePrivateTags: true,
        useCustomHandlers: false
      }

      const batchUpdates: Array<{batchIndex: number, totalBatches: number}> = []
      
      const anonymizedFiles = await anonymizer.anonymizeInBatches(
        parsedFiles,
        config,
        1, // Process one file per batch
        (batchIndex, totalBatches) => {
          batchUpdates.push({ batchIndex, totalBatches })
        }
      )
      
      expect(anonymizedFiles).toHaveLength(2)
      expect(anonymizedFiles.every(f => f.anonymized)).toBe(true)
      
      // Should have processed in 2 batches
      expect(batchUpdates).toHaveLength(2)
      expect(batchUpdates[0].totalBatches).toBe(2)
      expect(batchUpdates[1].totalBatches).toBe(2)
    })

    it('should validate anonymization config', async () => {
      const config: AnonymizationConfig = {
        profile: 'basic',
        removePrivateTags: true,
        useCustomHandlers: true
      }

      // Should not throw for valid config
      await expect(anonymizer.validateConfig(config)).resolves.not.toThrow()
    })
  })

  describe('DicomProcessor Effect-based methods', () => {
    it('should parse file using Effect-based method', async () => {
      const dicomFile = loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      
      // Test the Effect-based parse method
      const parsedFile = await dicomProcessor.parseFile(dicomFile)
      
      expect(parsedFile.metadata).toBeDefined()
      expect(parsedFile.metadata?.patientName).toBeDefined()
      expect(parsedFile.metadata?.studyInstanceUID).toBeDefined()
    })

    it('should parse multiple files concurrently', async () => {
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC'),
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0EEC66')
      ]
      
      // Test concurrent parsing
      const parsedFiles = await dicomProcessor.parseFiles(files, 2)
      
      expect(parsedFiles).toHaveLength(2)
      expect(parsedFiles[0].metadata).toBeDefined()
      expect(parsedFiles[1].metadata).toBeDefined()
    })

    it('should validate DICOM files', async () => {
      const dicomFile = loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      const parsedFile = dicomProcessor.parseDicomFile(dicomFile)
      
      // Test validation
      const metadata = await dicomProcessor.validateFile(parsedFile)
      
      expect(metadata).toBeDefined()
      expect(metadata.patientName).toBeDefined()
      expect(metadata.studyInstanceUID).toBeDefined()
    })

    it('should extract metadata from raw buffer', async () => {
      const dicomFile = loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      
      // Test metadata extraction from raw ArrayBuffer
      const metadata = await dicomProcessor.extractMetadataFromBuffer(dicomFile.arrayBuffer)
      
      expect(metadata).toBeDefined()
      expect(metadata.patientName).toBeDefined()
      expect(metadata.studyInstanceUID).toBeDefined()
    })
  })
})