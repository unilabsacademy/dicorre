/**
 * Application-wide Effect layers for dependency injection
 */

import { Effect, Layer } from "effect"
import { ConfigService, ConfigServiceLive } from '../config'
import { FileHandler, FileHandlerLive } from '../fileHandler'
import { OPFSStorage, OPFSStorageLive } from '../opfsStorage'
import { PluginRegistry, PluginRegistryLive } from '../pluginRegistry'
import { DicomProcessorLive } from '../dicomProcessor'
import { AnonymizerLive } from '../anonymizer'
import { DicomSenderLive } from '../dicomSender'
import { DownloadServiceLive } from '../downloadService'
import { EventBusLayer } from '../eventBus'

/**
 * Base services with no dependencies
 */
export const BaseServicesLayer = Layer.mergeAll(
  ConfigServiceLive,
  PluginRegistryLive,
  OPFSStorageLive
)

/**
 * Services that depend on base services
 */
export const ProcessingServicesLayer = Layer.mergeAll(
  DicomProcessorLive,
  FileHandlerLive.pipe(Layer.provide(PluginRegistryLive))
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
  PluginRegistryLive,
  OPFSStorageLive,
  DicomProcessorLive,
  AnonymizerLive,
  DicomSenderLive.pipe(Layer.provide(ConfigServiceLive)),
  DownloadServiceLive
).pipe(
  Layer.provideMerge(Layer.mergeAll(
    FileHandlerLive.pipe(Layer.provide(PluginRegistryLive))
  ))
)

/**
 * Individual service exports for selective use
 */
export const ConfigLayer = ConfigServiceLive
export const PluginRegistryLayer = PluginRegistryLive
export const FileHandlerLayer = FileHandlerLive.pipe(Layer.provide(PluginRegistryLive))
export const OPFSStorageLayer = OPFSStorageLive
export const DicomProcessorLayer = DicomProcessorLive.pipe(Layer.provide(BaseServicesLayer))
export const AnonymizerLayer = AnonymizerLive.pipe(Layer.provide(ProcessingServicesLayer))
export const DicomSenderLayer = DicomSenderLive.pipe(Layer.provide(ConfigServiceLive))
export const DownloadServiceLayer = DownloadServiceLive.pipe(Layer.provide(OPFSStorageLive))

