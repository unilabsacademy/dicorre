import { Context, Layer, Effect } from "effect"

export type LogLevel = 'info' | 'warn' | 'error'

export interface StudyLogEntry {
  ts: number
  level: LogLevel
  message: string
  details?: unknown
}

export class StudyLogger extends Context.Tag("StudyLogger")<
  StudyLogger,
  {
    readonly append: (studyId: string, entry: StudyLogEntry) => Effect.Effect<void, never>
    readonly get: (studyId: string) => Effect.Effect<StudyLogEntry[], never>
    readonly getStatus: (studyId: string) => Effect.Effect<{ hasError: boolean }, never>
    readonly clear: (studyId: string) => Effect.Effect<void, never>
    readonly clearAll: Effect.Effect<void, never>
  }
>() { }

export const StudyLoggerLive = Layer.succeed(
  StudyLogger,
  (() => {
    const logs = new Map<string, StudyLogEntry[]>()

    const append = (studyId: string, entry: StudyLogEntry) =>
      Effect.sync(() => {
        const arr = logs.get(studyId) ?? []
        arr.push(entry)
        logs.set(studyId, arr)
      })

    const get = (studyId: string) =>
      Effect.sync(() => logs.get(studyId) ?? [])

    const getStatus = (studyId: string) =>
      Effect.sync(() => ({ hasError: (logs.get(studyId) ?? []).some(e => e.level === 'error') }))

    const clear = (studyId: string) =>
      Effect.sync(() => { logs.delete(studyId) })

    const clearAll = Effect.sync(() => { logs.clear() })

    return {
      append,
      get,
      getStatus,
      clear,
      clearAll
    } as const
  })()
)


