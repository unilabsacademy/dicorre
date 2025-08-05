import { Effect, Context, Layer, PubSub } from "effect"
import type { AnonymizationEvent, SendingEvent, FileProcessingEvent } from '@/types/events'

/**
 * Event bus for anonymization events
 */
export class AnonymizationEventBus extends Context.Tag("AnonymizationEventBus")<
  AnonymizationEventBus,
  PubSub.PubSub<AnonymizationEvent>
>() {}

/**
 * Event bus for sending events
 */
export class SendingEventBus extends Context.Tag("SendingEventBus")<
  SendingEventBus,
  PubSub.PubSub<SendingEvent>
>() {}

/**
 * Event bus for file processing events
 */
export class FileProcessingEventBus extends Context.Tag("FileProcessingEventBus")<
  FileProcessingEventBus,
  PubSub.PubSub<FileProcessingEvent>
>() {}

/**
 * Layer for anonymization event bus
 */
export const AnonymizationEventBusLive = Layer.scoped(
  AnonymizationEventBus,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<AnonymizationEvent>()
    yield* Effect.addFinalizer(() => PubSub.shutdown(pubsub))
    return pubsub
  })
)

/**
 * Layer for sending event bus
 */
export const SendingEventBusLive = Layer.scoped(
  SendingEventBus,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<SendingEvent>()
    yield* Effect.addFinalizer(() => PubSub.shutdown(pubsub))
    return pubsub
  })
)

/**
 * Layer for file processing event bus
 */
export const FileProcessingEventBusLive = Layer.scoped(
  FileProcessingEventBus,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<FileProcessingEvent>()
    yield* Effect.addFinalizer(() => PubSub.shutdown(pubsub))
    return pubsub
  })
)

/**
 * Combined event bus layer
 */
export const EventBusLayer = Layer.mergeAll(
  AnonymizationEventBusLive,
  SendingEventBusLive,
  FileProcessingEventBusLive
)