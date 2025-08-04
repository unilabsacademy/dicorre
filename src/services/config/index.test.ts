import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { ConfigService, ConfigServiceLive } from './index'
import type { AppConfig, AnonymizationConfig } from '@/types/dicom'

describe('ConfigService (Effect Service Testing)', () => {
  // Test the service through Effect.provide pattern
  const runTest = <A, E>(effect: Effect.Effect<A, E, ConfigService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(ConfigServiceLive)))

  describe('Configuration validation', () => {
    it('should validate valid configuration successfully', async () => {
      const validConfig: AppConfig = {
        dicomServer: {
          url: 'http://localhost:8042',
          description: 'Test server'
        },
        anonymization: {
          profile: 'basic',
          removePrivateTags: true,
          useCustomHandlers: true,
          dateJitterDays: 30,
          preserveTags: [],
          tagsToRemove: [],
          customReplacements: {},
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
          profile: 'basic',
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
          profile: 'invalid-profile' as any,
          removePrivateTags: true,
          useCustomHandlers: true
        }
      }

      await expect(
        runTest(Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.validateConfig(invalidConfig)
        }))
      ).rejects.toThrow('Invalid anonymization profile')
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
      expect(config.profile).toBeDefined()
      expect(['basic', 'clean', 'very-clean']).toContain(config.profile)
    })

    it('should process timestamp replacements correctly', async () => {
      const replacements = {
        patientName: 'PATIENT_{timestamp}',
        studyDate: '2024{timestamp}'
      }

      const result = await runTest(Effect.gen(function* () {
        const configService = yield* ConfigService
        return yield* configService.processReplacements(replacements)
      }))
      
      expect(result.patientName).toMatch(/^PATIENT_\d{7}$/)
      expect(result.studyDate).toMatch(/^2024\d{7}$/)
    })

    it('should handle missing presets gracefully', async () => {
      await expect(
        runTest(Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.getAnonymizationPreset('nonexistent')
        }))
      ).rejects.toThrow('Preset \'nonexistent\' not found')
    })

    it('should get presets', async () => {
      const presets = await runTest(Effect.gen(function* () {
        const configService = yield* ConfigService
        return yield* configService.getPresets
      }))
      
      expect(presets).toBeDefined()
      expect(typeof presets).toBe('object')
    })

    it('should get tag description', async () => {
      const description = await runTest(Effect.gen(function* () {
        const configService = yield* ConfigService
        return yield* configService.getTagDescription('00100010')
      }))
      
      expect(typeof description).toBe('string')
    })

    it('should get tags to remove', async () => {
      const tags = await runTest(Effect.gen(function* () {
        const configService = yield* ConfigService
        return yield* configService.getTagsToRemove
      }))
      
      expect(Array.isArray(tags)).toBe(true)
    })
  })

  describe('Error handling', () => {
    it('should handle invalid replacement objects', async () => {
      await expect(
        runTest(Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.processReplacements(null as any)
        }))
      ).rejects.toThrow('Replacements must be a valid object')
    })

    it('should reject non-string replacement values', async () => {
      const invalidReplacements = {
        patientName: 'PATIENT_{timestamp}',
        invalidValue: 123 as any
      }

      await expect(
        runTest(Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.processReplacements(invalidReplacements)
        }))
      ).rejects.toThrow('Replacement value for \'invalidValue\' must be a string')
    })
  })
})