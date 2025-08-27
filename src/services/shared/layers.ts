/**
 * Application-wide Effect layers for dependency injection
 */

import { Layer } from "effect"
import { ConfigServiceLive } from '../config'
import { ConfigPersistenceLocalStorage } from '../configPersistence'
import { FileHandlerLive } from '../fileHandler'
import { OPFSStorageLive } from '../opfsStorage'
import { PluginRegistryLive } from '../pluginRegistry'
import { DicomProcessorLive } from '../dicomProcessor'
import { AnonymizerLive } from '../anonymizer'
import { DicomSenderLive } from '../dicomSender'
import { DownloadServiceLive } from '../downloadService'
import { SessionPersistenceLive } from '../sessionPersistence'
import { EventBusLayer } from '../eventBus'

/**
 * Base services with no dependencies
 */
export const BaseServicesLayer = Layer.mergeAll(
  ConfigServiceLive.pipe(Layer.provide(ConfigPersistenceLocalStorage)),
  PluginRegistryLive,
  OPFSStorageLive,
  SessionPersistenceLive
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
  AnonymizerLive.pipe(Layer.provide(Layer.mergeAll(DicomProcessorLive, ConfigServiceLive))),
  DicomSenderLive
).pipe(
  Layer.provide(ProcessingServicesLayer)
)

/**
 * Complete application layer with all services
 */
export const AppLayer = Layer.mergeAll(
  EventBusLayer,
  ConfigServiceLive.pipe(Layer.provide(ConfigPersistenceLocalStorage)),
  PluginRegistryLive,
  OPFSStorageLive,
  SessionPersistenceLive,
  DicomProcessorLive,
  AnonymizerLive.pipe(Layer.provide(Layer.mergeAll(DicomProcessorLive, ConfigServiceLive.pipe(Layer.provide(ConfigPersistenceLocalStorage))))),
  DicomSenderLive.pipe(Layer.provide(ConfigServiceLive.pipe(Layer.provide(ConfigPersistenceLocalStorage)))),
  DownloadServiceLive.pipe(Layer.provide(OPFSStorageLive))
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
export const AnonymizerLayer = AnonymizerLive.pipe(Layer.provide(Layer.mergeAll(ProcessingServicesLayer, ConfigServiceLive.pipe(Layer.provide(ConfigPersistenceLocalStorage)))))
export const DicomSenderLayer = DicomSenderLive.pipe(Layer.provide(ConfigServiceLive.pipe(Layer.provide(ConfigPersistenceLocalStorage))))
export const DownloadServiceLayer = DownloadServiceLive.pipe(Layer.provide(OPFSStorageLive))

