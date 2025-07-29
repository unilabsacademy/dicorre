import { Effect, Context, Layer } from "effect"
import type { AppConfig, DicomServerConfig, AnonymizationConfig } from '@/types/dicom'
import { ConfigurationError, ValidationError, type ConfigurationError as ConfigurationErrorType } from '@/types/effects'
import defaultConfig from '@/../app.config.json'

/**
 * Configuration service as proper Effect service
 */
export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  {
    readonly getServerConfig: Effect.Effect<DicomServerConfig, ConfigurationErrorType>
    readonly getAnonymizationConfig: Effect.Effect<AnonymizationConfig, ConfigurationErrorType>
    readonly getAnonymizationPreset: (presetName: string) => Effect.Effect<AnonymizationConfig, ConfigurationErrorType>
    readonly processReplacements: (replacements: Record<string, string>) => Effect.Effect<Record<string, string>, ConfigurationErrorType>
    readonly getPresets: Effect.Effect<Record<string, { profile: string; description: string }>, never>
    readonly getTagDescription: (tagId: string) => Effect.Effect<string, never>
    readonly getTagsToRemove: Effect.Effect<string[], never>
    readonly validateConfig: (config: AppConfig) => Effect.Effect<void, ConfigurationErrorType>
  }
>() {}

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
        return yield* Effect.fail(new ValidationError({
          message: 'Preset name cannot be empty',
          fileName: presetName
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
   * Process replacement patterns (e.g., {timestamp} -> actual timestamp)
   */
  static processReplacements = (replacements: Record<string, string>): Effect.Effect<Record<string, string>, ConfigurationErrorType> =>
    Effect.gen(function* () {
      if (!replacements || typeof replacements !== 'object') {
        return yield* Effect.fail(new ValidationError({
          message: 'Replacements must be a valid object',
          fileName: 'replacements'
        }))
      }

      const processed: Record<string, string> = {}
      const timestamp = Date.now().toString().slice(-6)
      
      for (const [key, value] of Object.entries(replacements)) {
        if (typeof value !== 'string') {
          return yield* Effect.fail(new ConfigurationError({
            message: `Replacement value for '${key}' must be a string`,
            setting: `replacements.${key}`,
            value: value
          }))
        }

        try {
          processed[key] = value.replace('{timestamp}', timestamp)
        } catch (error) {
          return yield* Effect.fail(new ConfigurationError({
            message: `Failed to process replacement for '${key}': ${error}`,
            setting: `replacements.${key}`,
            value: value,
            cause: error
          }))
        }
      }
      
      return processed
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
    processReplacements: ConfigServiceImpl.processReplacements,
    getPresets: ConfigServiceImpl.getPresets,
    getTagDescription: ConfigServiceImpl.getTagDescription,
    getTagsToRemove: ConfigServiceImpl.getTagsToRemove,
    validateConfig: ConfigServiceImpl.validateConfig
  })
)

