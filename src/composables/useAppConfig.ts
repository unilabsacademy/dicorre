import { ref, onMounted } from 'vue'
import { Effect, Layer } from 'effect'
import type { AnonymizationConfig } from '@/types/dicom'
import { ConfigService, ConfigServiceLive } from '@/services/config'

const configLayer = ConfigServiceLive

const run = <A>(effect: Effect.Effect<A, any, any>) =>
  Effect.runPromise(effect.pipe(Effect.provide(configLayer)))

export function useAppConfig() {
  const config = ref<AnonymizationConfig | null>(null)
  const loading = ref(false)
  const error = ref<Error | null>(null)

  const loadConfig = async () => {
    loading.value = true
    error.value = null
    try {
      const loadedConfig = await run(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.getAnonymizationConfig
        })
      )
      config.value = loadedConfig
      console.log('Loaded configuration from app.config.json:', loadedConfig)
      console.log('Loaded replacements object:', loadedConfig.replacements)
      console.log('Accession number replacement pattern:', loadedConfig.replacements?.accessionNumber)
      console.log('Patient ID replacement pattern:', loadedConfig.replacements?.patientId)
    } catch (e) {
      error.value = e as Error
      console.error('Failed to load configuration:', e)
      // Configuration is critical - throw error to stop app
      throw new Error(`Critical configuration loading failed: ${e}`)
    } finally {
      loading.value = false
    }
  }

  onMounted(() => {
    loadConfig()
  })

  return {
    config,
    loading,
    error,
    loadConfig
  }
}
