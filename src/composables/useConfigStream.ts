import { ref, onMounted, onUnmounted } from 'vue'
import { Effect, Stream, Fiber } from 'effect'
import type { RuntimeType } from '@/types/effects'
import { ConfigService } from '@/services/config'
import type { AppConfig, ProjectConfig } from '@/services/config/schema'

export function useConfigStream(runtime: RuntimeType) {
  const config = ref<AppConfig | null>(null)
  const currentProject = ref<ProjectConfig | undefined>(undefined)
  const serverUrl = ref<string>('')
  let subscription: Fiber.RuntimeFiber<never, void> | null = null

  onMounted(async () => {
    // Seed with current value
    try {
      const initial = await runtime.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConfigService
          return yield* svc.getCurrentConfig
        })
      )
      config.value = initial
      currentProject.value = initial.project
      // @ts-expect-error optional in schema
      serverUrl.value = (initial as any)?.dicomServer?.url ?? ''
    } catch {
      // ignore; stream will emit soon if service initializes later
    }

    // Subscribe to changes
    subscription = runtime.runFork(
      Effect.gen(function* () {
        const svc = yield* ConfigService
        return yield* Stream.runForEach(svc.configChanges, (cfg) =>
          Effect.sync(() => {
            config.value = cfg
            currentProject.value = cfg.project
            // @ts-expect-error optional in schema
            serverUrl.value = (cfg as any)?.dicomServer?.url ?? ''
          })
        )
      })
    )
  })

  onUnmounted(() => {
    if (subscription) {
      // Best-effort interruption
      void runtime.runPromise(subscription.interrupt)
      subscription = null
    }
  })

  return { config, currentProject, serverUrl }
}


