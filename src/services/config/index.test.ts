import { describe, it, expect } from 'vitest'
import { Effect, Layer } from 'effect'
import { ConfigService, ConfigServiceLive } from './index'
import type { AppConfig, DicomProfileOption } from './schema'
import { ConfigPersistence } from '@/services/configPersistence'
import defaultConfig from '@/../app.config.json'

describe('ConfigService (Effect Service Testing)', () => {
  // Create a test persistence layer that doesn't use localStorage
  const ConfigPersistenceTest = Layer.succeed(
    ConfigPersistence,
    {
      load: Effect.succeed(null),
      save: (_cfg: AppConfig) => Effect.succeed(undefined),
      clear: Effect.succeed(undefined)
    }
  )

  // Combine the layers for testing
  const TestLayers = Layer.provide(ConfigServiceLive, ConfigPersistenceTest)

  // Test the service through Effect.provide pattern
  const runTest = <A, E>(effect: Effect.Effect<A, E, ConfigService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(TestLayers)))

  describe('Configuration validation', () => {
    it('should validate valid configuration successfully', async () => {
      const validConfig: AppConfig = {
        dicomServer: {
          url: 'http://localhost:8042',
          description: 'Test server'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true,
          useCustomHandlers: true,
          dateJitterDays: 30,
          preserveTags: [],
          tagsToRemove: [],
          replacements: {}
        }
      }

      await expect(
        runTest(Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.validateConfig(validConfig)
        }))
      ).resolves.not.toThrow()
    })

    it('should reject configuration without DICOM server URL', async () => {
      const invalidConfig: AppConfig = {
        dicomServer: {
          url: '',
          description: 'Test server'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true,
          useCustomHandlers: true
        }
      }

      await expect(
        runTest(Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.validateConfig(invalidConfig)
        }))
      ).rejects.toThrow('DICOM server URL is required')
    })

    it('should reject configuration with invalid anonymization profile', async () => {
      const invalidConfig: AppConfig = {
        dicomServer: {
          url: 'http://localhost:8042',
          description: 'Test server'
        },
        anonymization: {
          profileOptions: ['invalid-profile' as DicomProfileOption],
          removePrivateTags: true,
          useCustomHandlers: true
        }
      }

      await expect(
        runTest(Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.validateConfig(invalidConfig)
        }))
      ).rejects.toThrow()
    })
  })

  describe('Service operations', () => {
    it('should get server config', async () => {
      const config = await runTest(Effect.gen(function* () {
        const configService = yield* ConfigService
        return yield* configService.getServerConfig
      }))

      expect(config).toBeDefined()
      expect(config.url).toBeDefined()
      expect(config.description).toBeDefined()
    })

    it('should get anonymization config', async () => {
      const config = await runTest(Effect.gen(function* () {
        const configService = yield* ConfigService
        return yield* configService.getAnonymizationConfig
      }))

      expect(config).toBeDefined()
      expect(config.profileOptions).toBeDefined()
      expect(Array.isArray(config.profileOptions)).toBe(true)
      expect(config.profileOptions.length).toBeGreaterThan(0)
    })
  })

  describe('Error handling', () => {
    it('should handle service errors gracefully', async () => {
      // Basic error handling test - just test basic validation
      const invalidConfig: AppConfig = {
        dicomServer: {
          url: '',
          description: 'Test server'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      await expect(
        runTest(Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.validateConfig(invalidConfig)
        }))
      ).rejects.toThrow()
    })
  })
})
