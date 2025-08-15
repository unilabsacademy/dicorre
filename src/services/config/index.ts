import { Effect, Context, Layer } from "effect"
import type { AppConfig, DicomServerConfig, AnonymizationConfig } from '@/types/dicom'
import { ConfigurationError, ValidationError, type ConfigurationError as ConfigurationErrorType } from '@/types/effects'
import defaultConfig from '@/../app.config.json'
import { validateAppConfig, type ValidatedAppConfig } from './schema'

/**
 * Configuration service as proper Effect service
 */
export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  {
    readonly getServerConfig: Effect.Effect<DicomServerConfig, ConfigurationErrorType>
    readonly getAnonymizationConfig: Effect.Effect<AnonymizationConfig, ConfigurationErrorType>
    readonly getAnonymizationPreset: (presetName: string) => Effect.Effect<AnonymizationConfig, ConfigurationErrorType>
    readonly getPresets: Effect.Effect<Record<string, { profile: string; description: string }>, never>
    readonly getTagDescription: (tagId: string) => Effect.Effect<string, never>
    readonly getTagsToRemove: Effect.Effect<string[], never>
    readonly validateConfig: (config: AppConfig) => Effect.Effect<void, ConfigurationErrorType>
    readonly loadConfig: (configData: unknown) => Effect.Effect<void, ConfigurationErrorType>
    readonly getCurrentConfig: Effect.Effect<AppConfig, never>
  }
>() { }

/**
 * Internal implementation class
 */
class ConfigServiceImpl {
  private static config: AppConfig = defaultConfig as AppConfig

  /**
   * Effect-based configuration validation
   */
  static validateConfig = (config: AppConfig): Effect.Effect<void, ConfigurationErrorType> =>
    Effect.gen(function* () {
      // Validate DICOM server configuration
      if (!config.dicomServer?.url) {
        return yield* Effect.fail(new ConfigurationError({
          message: 'DICOM server URL is required',
          setting: 'dicomServer.url',
          value: config.dicomServer?.url
        }))
      }

      // Validate anonymization configuration
      if (!config.anonymization) {
        return yield* Effect.fail(new ConfigurationError({
          message: 'Anonymization configuration is required',
          setting: 'anonymization',
          value: config.anonymization
        }))
      }

      // Validate profile
      if (!['basic', 'clean', 'very-clean'].includes(config.anonymization.profile)) {
        return yield* Effect.fail(new ConfigurationError({
          message: `Invalid anonymization profile: ${config.anonymization.profile}`,
          setting: 'anonymization.profile',
          value: config.anonymization.profile
        }))
      }

      // Validate date jitter if present
      if (config.anonymization.dateJitterDays !== undefined) {
        if (config.anonymization.dateJitterDays < 0 || config.anonymization.dateJitterDays > 365) {
          return yield* Effect.fail(new ConfigurationError({
            message: `Invalid dateJitterDays: ${config.anonymization.dateJitterDays}. Must be between 0 and 365.`,
            setting: 'anonymization.dateJitterDays',
            value: config.anonymization.dateJitterDays
          }))
        }
      }
    })

  /**
   * Get default DICOM server configuration
   */
  static getServerConfig: Effect.Effect<DicomServerConfig, ConfigurationErrorType> = Effect.gen(function* () {
    yield* ConfigServiceImpl.validateConfig(ConfigServiceImpl.config)
    return { ...ConfigServiceImpl.config.dicomServer }
  })

  /**
   * Get default anonymization configuration
   */
  static getAnonymizationConfig: Effect.Effect<AnonymizationConfig, ConfigurationErrorType> = Effect.gen(function* () {
    yield* ConfigServiceImpl.validateConfig(ConfigServiceImpl.config)
    const { tagDescriptions: _tagDescriptions, ...anonymizationConfig } = ConfigServiceImpl.config.anonymization
    return { ...anonymizationConfig }
  })

  /**
   * Get anonymization preset by name
   */
  static getAnonymizationPreset = (presetName: string): Effect.Effect<AnonymizationConfig, ConfigurationErrorType> =>
    Effect.gen(function* () {
      if (!presetName || presetName.trim() === '') {
        return yield* Effect.fail(new ConfigurationError({
          message: 'Preset name cannot be empty',
          setting: `presets.${presetName}`,
          value: presetName
        }))
      }

      const preset = ConfigServiceImpl.config.presets?.[presetName]
      if (!preset) {
        return yield* Effect.fail(new ConfigurationError({
          message: `Preset '${presetName}' not found`,
          setting: `presets.${presetName}`,
          value: presetName
        }))
      }

      // Merge preset with base anonymization config
      const mergedConfig = {
        ...ConfigServiceImpl.config.anonymization,
        profile: preset.profile,
        removePrivateTags: preset.removePrivateTags
      }

      // Validate the merged configuration
      if (!['basic', 'clean', 'very-clean'].includes(mergedConfig.profile)) {
        return yield* Effect.fail(new ConfigurationError({
          message: `Invalid profile in preset '${presetName}': ${mergedConfig.profile}`,
          setting: `presets.${presetName}.profile`,
          value: mergedConfig.profile
        }))
      }

      return mergedConfig
    })


  /**
   * Get all available presets
   */
  static getPresets: Effect.Effect<Record<string, { profile: string; description: string }>, never> = Effect.succeed(() => {
    const presets: Record<string, { profile: string; description: string }> = {}

    if (ConfigServiceImpl.config.presets) {
      for (const [key, preset] of Object.entries(ConfigServiceImpl.config.presets)) {
        presets[key] = {
          profile: preset.profile,
          description: preset.description
        }
      }
    }

    return presets
  }).pipe(Effect.map(fn => fn()))

  /**
   * Get tag description by tag ID
   */
  static getTagDescription = (tagId: string): Effect.Effect<string, never> =>
    Effect.succeed(ConfigServiceImpl.config.anonymization.tagDescriptions?.[tagId] || tagId)

  /**
   * Get list of tags to remove during anonymization
   */
  static getTagsToRemove: Effect.Effect<string[], never> =
    Effect.succeed(ConfigServiceImpl.config.anonymization.tagsToRemove || [])

  /**
   * Load and validate a new configuration
   */
  static loadConfig = (configData: unknown): Effect.Effect<void, ConfigurationErrorType> =>
    Effect.gen(function* () {
      // Validate the configuration using Schema
      const validationResult = yield* validateAppConfig(configData).pipe(
        Effect.mapError((error) => {
          // Parse the error to extract meaningful user-friendly message
          const errorMessage = error.message
          
          // Extract specific validation errors from the detailed schema error
          if (errorMessage.includes('DICOM server URL is required') || errorMessage.includes('is missing')) {
            return new ConfigurationError({
              message: 'DICOM server URL is required',
              setting: 'dicomServer.url',
              value: configData
            })
          }
          
          if (errorMessage.includes('URL must start with / or http')) {
            return new ConfigurationError({
              message: 'URL must start with / or http',
              setting: 'dicomServer.url',
              value: configData
            })
          }
          
          if (errorMessage.includes('dateJitterDays must be <= 365') || (errorMessage.includes('dateJitterDays') && errorMessage.includes('365'))) {
            return new ConfigurationError({
              message: 'Invalid dateJitterDays: must be between 0 and 365',
              setting: 'anonymization.dateJitterDays',
              value: configData
            })
          }
          
          if (errorMessage.includes('Expected "basic"') || errorMessage.includes('Expected "clean"') || errorMessage.includes('Expected "very-clean"') || errorMessage.includes('"basic" | "clean" | "very-clean"') || (errorMessage.includes('actual') && (errorMessage.includes('"basic"') || errorMessage.includes('"clean"') || errorMessage.includes('"very-clean"')))) {
            return new ConfigurationError({
              message: 'Invalid anonymization profile',
              setting: 'anonymization.profile',
              value: configData
            })
          }
          
          // Fallback for other validation errors
          return new ConfigurationError({
            message: `Configuration validation failed: ${errorMessage}`,
            setting: 'config',
            value: configData
          })
        })
      )

      // Additional business logic validation
      yield* ConfigServiceImpl.validateConfig(validationResult as AppConfig)

      // If validation passes, update the internal config
      ConfigServiceImpl.config = validationResult as AppConfig

      console.log('Configuration loaded successfully:', ConfigServiceImpl.config)
    })

  /**
   * Get the current configuration
   */
  static getCurrentConfig: Effect.Effect<AppConfig, never> =
    Effect.succeed(ConfigServiceImpl.config)
}

/**
 * Live implementation layer
 */
export const ConfigServiceLive = Layer.succeed(
  ConfigService,
  ConfigService.of({
    getServerConfig: ConfigServiceImpl.getServerConfig,
    getAnonymizationConfig: ConfigServiceImpl.getAnonymizationConfig,
    getAnonymizationPreset: ConfigServiceImpl.getAnonymizationPreset,
    getPresets: ConfigServiceImpl.getPresets,
    getTagDescription: ConfigServiceImpl.getTagDescription,
    getTagsToRemove: ConfigServiceImpl.getTagsToRemove,
    validateConfig: ConfigServiceImpl.validateConfig,
    loadConfig: ConfigServiceImpl.loadConfig,
    getCurrentConfig: ConfigServiceImpl.getCurrentConfig
  })
)

