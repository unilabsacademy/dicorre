import { Effect, Context, Layer, Ref } from "effect"
import type { AppConfig, DicomServerConfig, AnonymizationConfig, DicomProfileOption, ProjectConfig } from './schema'
import { ConfigurationError, type ConfigurationError as ConfigurationErrorType, type ParseError } from '@/types/effects'
import defaultConfig from '@/../app.config.json'
import { validateAppConfig, validateProjectConfig } from './schema'
import { tagNameToHex, isValidTagName } from '@/utils/dicom-tag-dictionary'
import { ConfigPersistence } from '@/services/configPersistence'

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
    readonly clearProject: Effect.Effect<void, ConfigurationErrorType>
  }
>() { }

export const ConfigServiceLive = Layer.scoped(
  ConfigService,
  Effect.gen(function* () {
    const ref = yield* Ref.make(defaultConfig as AppConfig)
    const persistence = yield* ConfigPersistence

    // On init, attempt to load persisted config; fall back to default
    const persisted = yield* persistence.load
    if (persisted) {
      yield* Ref.set(ref, persisted)
    }

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
      const cfg = yield* Ref.get(ref)
      yield* validateConfig(cfg)
      return { ...cfg.dicomServer }
    })

    const getAnonymizationConfig: Effect.Effect<AnonymizationConfig, ConfigurationErrorType> = Effect.gen(function* () {
      const cfg = yield* Ref.get(ref)
      yield* validateConfig(cfg)
      const anonymizationConfig = cfg.anonymization

      let preserveTags = anonymizationConfig.preserveTags
      if (preserveTags) {
        preserveTags = preserveTags.map(tag => {
          if (/^[0-9A-Fa-f]{8}$/.test(tag)) return tag
          if (isValidTagName(tag)) {
            const hex = tagNameToHex(tag)
            if (hex) return hex
          }
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
      yield* Ref.set(ref, validatedConfig)
      yield* persistence.save(validatedConfig)
      console.log('Configuration loaded successfully:', validatedConfig)
    })

    const getCurrentConfig: Effect.Effect<AppConfig, never> =
      Ref.get(ref)

    const getCurrentProject: Effect.Effect<ProjectConfig | undefined, never> =
      Effect.map(Ref.get(ref), (c) => c.project)

    const createProject = (name: string): Effect.Effect<ProjectConfig, never> =>
      Effect.succeed({
        name,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString()
      })

    const loadProject = (projectConfig: unknown) => Effect.gen(function* () {
      const project = yield* validateProjectConfig(projectConfig)
      yield* Ref.update(ref, (c) => ({ ...c, project }))
      const updated = yield* Ref.get(ref)
      yield* persistence.save(updated)
    })

    const clearProject: Effect.Effect<void, ConfigurationErrorType> = Effect.gen(function* () {
      yield* Ref.update(ref, (c) => {
        const { project: _omit, ...rest } = c
        return rest as AppConfig
      })
      const updated = yield* Ref.get(ref)
      yield* persistence.save(updated)
      console.log('Project cleared, returned to default configuration')
    })

    return {
      getServerConfig,
      getAnonymizationConfig,
      validateConfig,
      loadConfig,
      getCurrentConfig,
      getCurrentProject,
      createProject,
      loadProject,
      clearProject
    } as const
  })
)

