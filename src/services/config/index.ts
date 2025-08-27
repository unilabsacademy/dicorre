import { Effect, Context, Layer } from "effect"
import type { AppConfig, DicomServerConfig, AnonymizationConfig, DicomProfileOption, ProjectConfig } from './schema'
import { ConfigurationError, type ConfigurationError as ConfigurationErrorType, type ParseError } from '@/types/effects'
import defaultConfig from '@/../app.config.json'
import { validateAppConfig, validateProjectConfig } from './schema'
import { tagNameToHex, isValidTagName } from '@/utils/dicom-tag-dictionary'

export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  {
    readonly getServerConfig: Effect.Effect<DicomServerConfig, ConfigurationErrorType>
    readonly getAnonymizationConfig: Effect.Effect<AnonymizationConfig, ConfigurationErrorType>
    readonly validateConfig: (config: unknown) => Effect.Effect<AppConfig, ConfigurationErrorType>
    readonly loadConfig: (configData: unknown) => Effect.Effect<void, ConfigurationErrorType>
    readonly getCurrentConfig: Effect.Effect<AppConfig, never>
    readonly getCurrentProject: Effect.Effect<ProjectConfig | undefined, never>
    readonly createProject: (name: string) => Effect.Effect<ProjectConfig, never>
    readonly loadProject: (projectConfig: unknown) => Effect.Effect<void, ParseError | ConfigurationError>
  }
>() { }

export const ConfigServiceLive = Layer.succeed(
  ConfigService,
  (() => {
    // Private state encapsulated in closure
    let config: AppConfig = defaultConfig as AppConfig

    const validateConfig = (configToValidate: unknown): Effect.Effect<AppConfig, ConfigurationErrorType> =>
      validateAppConfig(configToValidate).pipe(
        Effect.mapError((parseError) =>
          new ConfigurationError({
            message: `Configuration validation failed: ${parseError.message}`,
            setting: 'config',
            value: configToValidate
          })
        )
      )

    const getServerConfig: Effect.Effect<DicomServerConfig, ConfigurationErrorType> = Effect.gen(function* () {
      yield* validateConfig(config)
      return { ...config.dicomServer }
    })

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

    const loadConfig = (configData: unknown): Effect.Effect<void, ConfigurationErrorType> => Effect.gen(function* () {
      const validatedConfig = yield* validateConfig(configData)
      config = validatedConfig
      console.log('Configuration loaded successfully:', config)
    })

    const getCurrentConfig: Effect.Effect<AppConfig, never> =
      Effect.succeed(config)

    const getCurrentProject: Effect.Effect<ProjectConfig | undefined, never> =
      Effect.succeed(config.project)

    const createProject = (name: string): Effect.Effect<ProjectConfig, never> =>
      Effect.succeed({
        name,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString()
      })

    const loadProject = (projectConfig: unknown) => Effect.gen(function* () {
      const project = yield* validateProjectConfig(projectConfig)
      yield* loadConfig({ ...config, project })
    })

    return {
      getServerConfig,
      getAnonymizationConfig,
      validateConfig,
      loadConfig,
      getCurrentConfig,
      getCurrentProject,
      createProject,
      loadProject
    } as const
  })()
)

