/**
 * Application-wide Effect layers for dependency injection
 */

import { Effect, Layer } from "effect"
import { ConfigService, ConfigServiceLive } from '../config'
import { FileHandler, FileHandlerLive } from '../fileHandler'
import { OPFSStorage, OPFSStorageLive } from '../opfsStorage'
import { DicomProcessorLive } from '../dicomProcessor'
import { AnonymizerLive } from '../anonymizer'
import { DicomSenderLive } from '../dicomSender'
import { EventBusLayer } from '../eventBus'
import { ConfigurationError } from '@/types/effects'
import type { AppConfig } from "@/types/dicom"

/**
 * Base services with no dependencies
 */
export const BaseServicesLayer = Layer.mergeAll(
  ConfigServiceLive,
  FileHandlerLive,
  OPFSStorageLive
)

/**
 * Services that depend on base services
 */
export const ProcessingServicesLayer = Layer.mergeAll(
  DicomProcessorLive,
).pipe(
  Layer.provide(BaseServicesLayer)
)

/**
 * Services that depend on processing services
 */
export const AdvancedServicesLayer = Layer.mergeAll(
  AnonymizerLive,
  DicomSenderLive
).pipe(
  Layer.provide(ProcessingServicesLayer)
)

/**
 * Complete application layer with all services
 */
export const AppLayer = Layer.mergeAll(
  EventBusLayer,
  ConfigServiceLive,
  FileHandlerLive,
  OPFSStorageLive,
  DicomProcessorLive,
  AnonymizerLive,
  DicomSenderLive.pipe(Layer.provide(ConfigServiceLive))
)

/**
 * Individual service exports for selective use
 */
export const ConfigLayer = ConfigServiceLive
export const FileHandlerLayer = FileHandlerLive
export const OPFSStorageLayer = OPFSStorageLive
export const DicomProcessorLayer = DicomProcessorLive.pipe(Layer.provide(BaseServicesLayer))
export const AnonymizerLayer = AnonymizerLive.pipe(Layer.provide(ProcessingServicesLayer))
export const DicomSenderLayer = DicomSenderLive.pipe(Layer.provide(ConfigServiceLive))

/**
 * Test layers for isolated testing (without dependencies)
 */
export const TestConfigLayer = Layer.succeed(
  ConfigService,
  ConfigService.of({
    getServerConfig: Effect.succeed({
      url: 'http://localhost:8042',
      description: 'Test server'
    }),
    getAnonymizationConfig: Effect.succeed({
      profile: 'basic',
      removePrivateTags: true,
      useCustomHandlers: true,
      dateJitterDays: 30,
      preserveTags: [],
      tagsToRemove: [],
      customReplacements: {},
      replacements: {}
    }),
    getAnonymizationPreset: (presetName: string) => Effect.fail(new ConfigurationError({
      message: `Preset '${presetName}' not found`,
      setting: `presets.${presetName}`,
      value: presetName
    })),
    getPresets: Effect.succeed({}),
    getTagDescription: (tagId: string) => Effect.succeed(tagId),
    getTagsToRemove: Effect.succeed([]),
    validateConfig: (config: AppConfig) => Effect.succeed(undefined),
    loadConfig: (configData: unknown) => Effect.succeed(undefined),
    getCurrentConfig: Effect.succeed({
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
    })
  })
)

export const TestFileHandlerLayer = Layer.succeed(
  FileHandler,
  FileHandler.of({
    extractZipFile: (file: File) => Effect.succeed([]),
    readSingleDicomFile: (file: File) => Effect.succeed({
      id: 'test-file',
      fileName: file.name,
      fileSize: file.size,
      arrayBuffer: new ArrayBuffer(100),
      anonymized: false
    }),
    validateDicomFile: (arrayBuffer: ArrayBuffer, fileName: string) => Effect.succeed(true)
  })
)

export const TestOPFSStorageLayer = Layer.succeed(
  OPFSStorage,
  OPFSStorage.of({
    saveFile: (fileId: string, arrayBuffer: ArrayBuffer) => Effect.succeed(undefined),
    loadFile: (fileId: string) => Effect.succeed(new ArrayBuffer(100)),
    fileExists: (fileId: string) => Effect.succeed(true),
    deleteFile: (fileId: string) => Effect.succeed(undefined),
    listFiles: Effect.succeed([]),
    clearAllFiles: Effect.succeed(undefined),
    getStorageInfo: Effect.succeed({ used: 0, quota: 1000 })
  })
)
