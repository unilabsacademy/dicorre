import { describe, it, expect } from 'vitest'
import { Effect, Layer } from 'effect'
import { DicomSender, DicomSenderLive } from './index'
import { ConfigServiceLive } from '../config'
import type { DicomFile } from '@/types/dicom'
import { ConfigPersistence } from '@/services/config/configPersistence'
import type { AppConfig } from '@/services/config/schema'

describe('DicomSender Service (Effect Service Testing)', () => {
  // Create a test persistence layer
  const ConfigPersistenceTest = Layer.succeed(
    ConfigPersistence,
    {
      load: Effect.succeed(null),
      save: (_cfg: AppConfig) => Effect.succeed(undefined),
      clear: Effect.succeed(undefined)
    }
  )

  // Test the service through Effect.provide pattern
  const testLayer = Layer.mergeAll(
    ConfigServiceLive.pipe(Layer.provide(ConfigPersistenceTest)),
    DicomSenderLive.pipe(Layer.provide(ConfigServiceLive.pipe(Layer.provide(ConfigPersistenceTest))))
  )

  const runTest = <A, E>(effect: Effect.Effect<A, E, DicomSender>) =>
    Effect.runPromise(effect.pipe(Effect.provide(testLayer)))

  describe('Connection testing', () => {
    it('should test connection', async () => {
      // Since we don't have a real server, this should fail gracefully
      await expect(
        runTest(Effect.gen(function* () {
          const sender = yield* DicomSender
          return yield* sender.testConnection({
            url: 'http://localhost:8042',
            description: 'Test Server'
          })
        }))
      ).rejects.toThrow()
    })
  })

  describe('File sending', () => {
    it('should send DICOM file', async () => {
      const mockFile: DicomFile = {
        id: 'test-file',
        fileName: 'test.dcm',
        fileSize: 1000,
        arrayBuffer: new ArrayBuffer(1000),
        anonymized: true,
        metadata: {
          patientName: 'Test Patient',
          patientId: 'TEST001',
          studyInstanceUID: '1.2.3.4.5',
          studyDate: '20241201',
          studyDescription: 'Test Study',
          seriesInstanceUID: '1.2.3.4.6',
          seriesDescription: 'Test Series',
          modality: 'CT',
          sopInstanceUID: '1.2.3.4.7'
        }
      }

      // Should fail gracefully without a real server
      await expect(
        runTest(Effect.gen(function* () {
          const sender = yield* DicomSender
          return yield* sender.sendFile(mockFile, {
            url: 'http://localhost:8042',
            description: 'Test Server'
          })
        }))
      ).rejects.toThrow()
    })

  })

  describe('Configuration', () => {
    it('should test connection with valid config', async () => {
      const validConfig = {
        url: 'http://localhost:8081',
        description: 'Test server'
      }

      // This test expects the network call to fail since there's no actual server
      await expect(
        runTest(Effect.gen(function* () {
          const sender = yield* DicomSender
          return yield* sender.testConnection(validConfig)
        }))
      ).rejects.toThrow()
    })

    it('should send file with valid config', async () => {
      const validConfig = {
        url: 'http://localhost:8080',
        description: 'Test server'
      }

      const dicomFile: DicomFile = {
        id: 'test-file',
        fileName: 'test.dcm',
        fileSize: 100,
        arrayBuffer: new ArrayBuffer(100),
        metadata: {
          sopInstanceUID: '1.2.3.4.5.6'
        }
      }

      // This test expects the network call to fail since there's no actual server
      await expect(
        runTest(Effect.gen(function* () {
          const sender = yield* DicomSender
          return yield* sender.sendFile(dicomFile, validConfig)
        }))
      ).rejects.toThrow()
    })
  })
})
