import { describe, it, expect } from 'vitest'
import { Effect, Layer } from 'effect'
import { DicomSender, DicomSenderLive } from './index'
import { ConfigServiceLive } from '../config'
import type { DicomFile } from '@/types/dicom'
import { ConfigPersistence } from '@/services/configPersistence'
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
          return yield* sender.testConnection
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
          return yield* sender.sendFile(mockFile)
        }))
      ).rejects.toThrow()
    })

  })

  describe('Configuration', () => {
    it('should get current config', async () => {
      const config = await runTest(Effect.gen(function* () {
        const sender = yield* DicomSender
        return yield* sender.getConfig
      }))

      expect(config).toBeDefined()
      expect(config.url).toBeDefined()
    })

    it('should validate server config', async () => {
      const invalidConfig = {
        url: '',
        description: 'Invalid server'
      }

      await expect(
        runTest(Effect.gen(function* () {
          const sender = yield* DicomSender
          return yield* sender.updateConfig(invalidConfig)
        }))
      ).rejects.toThrow()
    })
  })
})
