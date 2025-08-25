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

export const ConfigServiceLive = Layer.succeed(
  ConfigService,
  (() => {
    // Private state encapsulated in closure
    let config: AppConfig = defaultConfig as AppConfig

    const validateConfig = (configToValidate: AppConfig): Effect.Effect<void, ConfigurationErrorType> =>
      Effect.gen(function* () {
        // Validate DICOM server configuration
        if (!configToValidate.dicomServer?.url) {
          return yield* Effect.fail(new ConfigurationError({
            message: 'DICOM server URL is required',
            setting: 'dicomServer.url',
            value: configToValidate.dicomServer?.url
          }))
        }

        // Validate anonymization configuration
        if (!configToValidate.anonymization) {
          return yield* Effect.fail(new ConfigurationError({
            message: 'Anonymization configuration is required',
            setting: 'anonymization',
            value: configToValidate.anonymization
          }))
        }

        // Validate profile options
        if (!configToValidate.anonymization.profileOptions || !Array.isArray(configToValidate.anonymization.profileOptions)) {
          return yield* Effect.fail(new ConfigurationError({
            message: 'Profile options must be an array',
            setting: 'anonymization.profileOptions',
            value: configToValidate.anonymization.profileOptions
          }))
        }

        if (configToValidate.anonymization.profileOptions.length === 0) {
          return yield* Effect.fail(new ConfigurationError({
            message: 'At least one profile option is required',
            setting: 'anonymization.profileOptions',
            value: configToValidate.anonymization.profileOptions
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
        for (const profileOption of configToValidate.anonymization.profileOptions) {
          if (!validProfileOptions.includes(profileOption as DicomProfileOption)) {
            return yield* Effect.fail(new ConfigurationError({
              message: `Invalid profile option: ${profileOption}. Valid options are: ${validProfileOptions.join(', ')}`,
              setting: 'anonymization.profileOptions',
              value: profileOption
            }))
          }
        }

        // Validate date jitter if present
        if (configToValidate.anonymization.dateJitterDays !== undefined) {
          if (configToValidate.anonymization.dateJitterDays < 0 || configToValidate.anonymization.dateJitterDays > 365) {
            return yield* Effect.fail(new ConfigurationError({
              message: `Invalid dateJitterDays: ${configToValidate.anonymization.dateJitterDays}. Must be between 0 and 365.`,
              setting: 'anonymization.dateJitterDays',
              value: configToValidate.anonymization.dateJitterDays
            }))
          }
        }
      })

    /* Get default DICOM server configuration */
    const getServerConfig: Effect.Effect<DicomServerConfig, ConfigurationErrorType> = Effect.gen(function* () {
      yield* validateConfig(config)
      return { ...config.dicomServer }
    })

    /* Get default anonymization configuration */
    const getAnonymizationConfig: Effect.Effect<AnonymizationConfig, ConfigurationErrorType> = Effect.gen(function* () {
      yield* validateConfig(config)
      const anonymizationConfig = config.anonymization

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
    const getTagsToRemove: Effect.Effect<string[], never> =
      Effect.succeed([...(config.anonymization.tagsToRemove || [])])

    /* Load and validate a new configuration */
    const loadConfig = (configData: unknown): Effect.Effect<void, ConfigurationErrorType> =>
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
        yield* validateConfig(validationResult)

        // If validation passes, update the internal config
        config = validationResult

        console.log('Configuration loaded successfully:', config)
      })

    /* Get the current configuration */
    const getCurrentConfig: Effect.Effect<AppConfig, never> =
      Effect.succeed(config)

    return {
      getServerConfig,
      getAnonymizationConfig,
      getTagsToRemove,
      validateConfig,
      loadConfig,
      getCurrentConfig
    } as const
  })()
)

