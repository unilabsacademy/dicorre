import { ref, onMounted } from 'vue'
import { Effect, Stream } from 'effect'
import type { RuntimeType } from '@/types/effects'
import { ConfigService } from '@/services/config'
import type { AppConfig } from '@/services/config/schema'

export function useConfigStream(runtime: RuntimeType) {
  const config = ref<AppConfig | null>(null)

  onMounted(async () => {
    config.value = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* ConfigService
        return yield* svc.getCurrentConfig
      })
    )

    runtime.runFork(
      Effect.gen(function* () {
        const svc = yield* ConfigService
        return yield* Stream.runForEach(svc.configChanges, (cfg) =>
          Effect.sync(() => config.value = cfg)
        )
      })
    )
  })

  return { config }
}


