import { Effect, Context, Layer } from "effect"
import type { AppConfig, DicomServerConfig, AnonymizationConfig, DicomProfileOption } from '@/types/dicom'
import { ConfigurationError, ValidationError, type ConfigurationError as ConfigurationErrorType } from '@/types/effects'
import defaultConfig from '@/../app.config.json'
import { validateAppConfig, type ValidatedAppConfig } from './schema'
import { tagNameToHex, isValidTagName } from '@/utils/dicom-tag-dictionary'

/**
 * Configuration service as proper Effect service
 */
export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  {
    readonly getServerConfig: Effect.Effect<DicomServerConfig, ConfigurationErrorType>
    readonly getAnonymizationConfig: Effect.Effect<AnonymizationConfig, ConfigurationErrorType>
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

      // Validate profile options
      if (!config.anonymization.profileOptions || !Array.isArray(config.anonymization.profileOptions)) {
        return yield* Effect.fail(new ConfigurationError({
          message: 'Profile options must be an array',
          setting: 'anonymization.profileOptions',
          value: config.anonymization.profileOptions
        }))
      }

      if (config.anonymization.profileOptions.length === 0) {
        return yield* Effect.fail(new ConfigurationError({
          message: 'At least one profile option is required',
          setting: 'anonymization.profileOptions',
          value: config.anonymization.profileOptions
        }))
      }

      // Valid DICOM profile options
      const validProfileOptions: DicomProfileOption[] = [
        'BasicProfile',
        'RetainLongModifDatesOption',
        'RetainLongFullDatesOption',
        'RetainUIDsOption',
        'CleanGraphOption',
        'RetainPatientCharsOption',
        'RetainSafePrivateOption',
        'CleanDescOption',
        'RetainDeviceIdentOption',
        'RetainInstIdentOption',
        'CleanStructContOption'
      ]

      // Check each profile option is valid
      for (const profileOption of config.anonymization.profileOptions) {
        if (!validProfileOptions.includes(profileOption as DicomProfileOption)) {
          return yield* Effect.fail(new ConfigurationError({
            message: `Invalid profile option: ${profileOption}. Valid options are: ${validProfileOptions.join(', ')}`,
            setting: 'anonymization.profileOptions',
            value: profileOption
          }))
        }
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
    
    // Convert tag names to hex values for preserveTags
    let preserveTags = anonymizationConfig.preserveTags
    if (preserveTags) {
      preserveTags = preserveTags.map(tag => {
        // If it's already a hex value, keep it as is
        if (/^[0-9A-Fa-f]{8}$/.test(tag)) {
          return tag
        }
        // If it's a tag name, convert to hex
        if (isValidTagName(tag)) {
          const hex = tagNameToHex(tag)
          if (hex) return hex
        }
        // Return as is if conversion fails (validation will catch invalid tags)
        return tag
      })
    }
    
    return { 
      ...anonymizationConfig,
      preserveTags
    }
  })


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
          
          if (errorMessage.includes('Expected "BasicProfile"') || errorMessage.includes('profile option') || errorMessage.includes('At least one profile option is required') || errorMessage.includes('profileOptions')) {
            return new ConfigurationError({
              message: 'Invalid anonymization profile options',
              setting: 'anonymization.profileOptions',
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
    getTagDescription: ConfigServiceImpl.getTagDescription,
    getTagsToRemove: ConfigServiceImpl.getTagsToRemove,
    validateConfig: ConfigServiceImpl.validateConfig,
    loadConfig: ConfigServiceImpl.loadConfig,
    getCurrentConfig: ConfigServiceImpl.getCurrentConfig
  })
)

