import { Effect, Context, Layer, PubSub } from "effect"
import type { AnonymizationEvent, SendingEvent, FileProcessingEvent } from '@/types/events'

export class AnonymizationEventBus extends Context.Tag("AnonymizationEventBus")<
  AnonymizationEventBus,
  PubSub.PubSub<AnonymizationEvent>
>() { }

export class SendingEventBus extends Context.Tag("SendingEventBus")<
  SendingEventBus,
  PubSub.PubSub<SendingEvent>
>() { }

export class FileProcessingEventBus extends Context.Tag("FileProcessingEventBus")<
  FileProcessingEventBus,
  PubSub.PubSub<FileProcessingEvent>
>() { }

export const AnonymizationEventBusLive = Layer.scoped(
  AnonymizationEventBus,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<AnonymizationEvent>()
    yield* Effect.addFinalizer(() => PubSub.shutdown(pubsub))
    return pubsub
  })
)

export const SendingEventBusLive = Layer.scoped(
  SendingEventBus,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<SendingEvent>()
    yield* Effect.addFinalizer(() => PubSub.shutdown(pubsub))
    return pubsub
  })
)

export const FileProcessingEventBusLive = Layer.scoped(
  FileProcessingEventBus,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<FileProcessingEvent>()
    yield* Effect.addFinalizer(() => PubSub.shutdown(pubsub))
    return pubsub
  })
)

export const EventBusLayer = Layer.mergeAll(
  AnonymizationEventBusLive,
  SendingEventBusLive,
  FileProcessingEventBusLive
)
