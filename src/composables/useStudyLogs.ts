import { computed, shallowRef, inject } from 'vue'
import { Effect } from 'effect'
import type { RuntimeType } from '@/types/effects'
import { StudyLogger, type StudyLogEntry } from '@/services/studyLogger'

export function useStudyLogs(runtimeArg?: RuntimeType) {
  const runtime = runtimeArg ?? inject<RuntimeType>('appRuntime')!
  const cache = shallowRef<Map<string, StudyLogEntry[]>>(new Map())

  const getLogs = async (studyId: string) => {
    const entries = await runtime.runPromise(Effect.gen(function* () {
      const logger = yield* StudyLogger
      return yield* logger.get(studyId)
    }))
    cache.value.set(studyId, entries)
    cache.value = new Map(cache.value)
  }

  const logsFor = (studyId: string) => computed(() => cache.value.get(studyId) ?? [])

  return { getLogs, logsFor }
}


