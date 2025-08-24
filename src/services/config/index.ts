import { Effect, Context, Layer, ParseResult } from "effect"
import type { AppConfig, DicomServerConfig, AnonymizationConfig, DicomProfileOption } from './schema'
import { ConfigurationError, type ConfigurationError as ConfigurationErrorType } from '@/types/effects'
import defaultConfig from '@/../app.config.json'
import { validateAppConfig } from './schema'
import { tagNameToHex, isValidTagName } from '@/utils/dicom-tag-dictionary'

export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  {
    readonly getServerConfig: Effect.Effect<DicomServerConfig, ConfigurationErrorType>
    readonly getAnonymizationConfig: Effect.Effect<AnonymizationConfig, ConfigurationErrorType>
    readonly getTagsToRemove: Effect.Effect<string[], never>
    readonly validateConfig: (config: AppConfig) => Effect.Effect<void, ConfigurationErrorType>
    readonly loadConfig: (configData: unknown) => Effect.Effect<void, ConfigurationErrorType>
    readonly getCurrentConfig: Effect.Effect<AppConfig, never>
  }
>() { }

class ConfigServiceImpl {
  private static config: AppConfig = defaultConfig as AppConfig

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

  /* Get default DICOM server configuration */
  static getServerConfig: Effect.Effect<DicomServerConfig, ConfigurationErrorType> = Effect.gen(function* () {
    yield* ConfigServiceImpl.validateConfig(ConfigServiceImpl.config)
    return { ...ConfigServiceImpl.config.dicomServer }
  })

  /* Get default anonymization configuration */
  static getAnonymizationConfig: Effect.Effect<AnonymizationConfig, ConfigurationErrorType> = Effect.gen(function* () {
    yield* ConfigServiceImpl.validateConfig(ConfigServiceImpl.config)
    const anonymizationConfig = ConfigServiceImpl.config.anonymization

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
      removePrivateTags: anonymizationConfig.removePrivateTags,
      profileOptions: [...anonymizationConfig.profileOptions] as DicomProfileOption[],
      replacements: anonymizationConfig.replacements,
      preserveTags: preserveTags ? [...preserveTags] : undefined,
      tagsToRemove: anonymizationConfig.tagsToRemove ? [...anonymizationConfig.tagsToRemove] : undefined,
      dateJitterDays: anonymizationConfig.dateJitterDays,
      useCustomHandlers: anonymizationConfig.useCustomHandlers,
      organizationRoot: anonymizationConfig.organizationRoot
    }
  })


  /* Get list of tags to remove during anonymization */
  static getTagsToRemove: Effect.Effect<string[], never> =
    Effect.succeed([...(ConfigServiceImpl.config.anonymization.tagsToRemove || [])])

  /* Load and validate a new configuration */
  static loadConfig = (configData: unknown): Effect.Effect<void, ConfigurationErrorType> =>
    Effect.gen(function* () {
      // Validate the configuration using Schema
      const validationResult = yield* validateAppConfig(configData).pipe(
        Effect.mapError((parseError) => {
          // Use ArrayFormatter to get structured error information
          const errors = ParseResult.ArrayFormatter.formatErrorSync(parseError)

          // If we got structured errors, use the first one to create a meaningful error
          if (errors.length > 0) {
            const firstError = errors[0]
            const path = firstError.path?.join('.') || 'config'

            // Use the path and message from the error directly
            return new ConfigurationError({
              message: firstError.message,
              setting: path,
              value: configData
            })
          }

          // Fallback if we couldn't parse the errors (shouldn't happen)
          return new ConfigurationError({
            message: `Configuration validation failed: ${parseError.message}`,
            setting: 'config',
            value: configData
          })
        })
      )

      // Additional business logic validation
      yield* ConfigServiceImpl.validateConfig(validationResult)

      // If validation passes, update the internal config
      ConfigServiceImpl.config = validationResult

      console.log('Configuration loaded successfully:', ConfigServiceImpl.config)
    })

  /* Get the current configuration */
  static getCurrentConfig: Effect.Effect<AppConfig, never> =
    Effect.succeed(ConfigServiceImpl.config)
}

export const ConfigServiceLive = Layer.succeed(
  ConfigService,
  ConfigService.of({
    getServerConfig: ConfigServiceImpl.getServerConfig,
    getAnonymizationConfig: ConfigServiceImpl.getAnonymizationConfig,
    getTagsToRemove: ConfigServiceImpl.getTagsToRemove,
    validateConfig: ConfigServiceImpl.validateConfig,
    loadConfig: ConfigServiceImpl.loadConfig,
    getCurrentConfig: ConfigServiceImpl.getCurrentConfig
  })
)

