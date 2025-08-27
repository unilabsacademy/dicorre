import { ref, computed, onMounted, inject } from 'vue'
import { Effect, ManagedRuntime } from 'effect'
import pako from 'pako'
import { ConfigService } from '@/services/config'
import type { AppConfig, ProjectConfig } from '@/services/config/schema'
import { toast } from 'vue-sonner'

// Flag to ensure URL loading happens only once per app lifecycle
const isInitialized = ref(false)

export function useProjectSharing() {
  const runtime = inject<ManagedRuntime.ManagedRuntime<any, never>>('appRuntime')
  if (!runtime) {
    throw new Error('App runtime not found. Make sure useProjectSharing is called within a component that has access to the app runtime.')
  }

  // Get current project from ConfigService
  const currentProject = ref<ProjectConfig | undefined>()
  const isProjectMode = computed(() => !!currentProject.value)

  // Reactive function to update project from ConfigService
  const updateCurrentProject = async () => {
    try {
      const project = await runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.getCurrentProject
        })
      )
      console.log('updateCurrentProject:', project ? `Found project: ${project.name}` : 'No project found')
      currentProject.value = project
    } catch (error) {
      console.error('Failed to get current project:', error)
      currentProject.value = undefined
    }
  }

  /**
   * Create a new project from current config
   */
  async function createProject(name: string): Promise<void> {
    try {
      // Get current config
      const config = await runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.getCurrentConfig
        })
      )

      // Create project metadata
      const project: ProjectConfig = {
        name,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString()
      }

      // Update config with project
      const configWithProject: AppConfig = {
        ...config,
        project
      }

      // Load the updated config
      await runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          yield* configService.loadConfig(configWithProject)
        })
      )

      // Update local reactive state immediately
      await updateCurrentProject()
      toast.success(`Project "${name}" created`)

      // Force another update after a short delay to ensure UI sync
      setTimeout(updateCurrentProject, 100)
    } catch (error) {
      console.error('Failed to create project:', error)
      toast.error('Failed to create project')
      throw error
    }
  }

  /**
   * Encode config to shareable URL
   */
  async function generateShareableUrl(): Promise<string> {
    try {
      // Get current config
      const config = await runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.getCurrentConfig
        })
      )

      // Convert to JSON and compress
      const jsonString = JSON.stringify(config)
      const compressed = pako.deflate(jsonString)
      const base64 = btoa(String.fromCharCode.apply(null, Array.from(compressed)))

      // URL-safe base64
      const urlSafeBase64 = base64
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '')

      // Generate URL
      const url = new URL(window.location.href)
      url.searchParams.set('project', urlSafeBase64)

      return url.toString()
    } catch (error) {
      console.error('Failed to generate shareable URL:', error)
      toast.error('Failed to generate shareable URL')
      throw error
    }
  }

  /**
   * Load project from URL parameter
   */
  async function loadProjectFromUrl(): Promise<boolean> {
    try {
      const url = new URL(window.location.href)
      const encodedProject = url.searchParams.get('project')

      if (!encodedProject) {
        return false
      }

      // Decode from URL-safe base64
      const base64 = encodedProject
        .replace(/-/g, '+')
        .replace(/_/g, '/')

      // Add padding if needed
      const padding = (4 - (base64.length % 4)) % 4
      const paddedBase64 = base64 + '='.repeat(padding)

      let config: AppConfig

      try {
        // Try to decompress first (assuming compressed data)
        const binaryString = atob(paddedBase64)
        const compressed = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          compressed[i] = binaryString.charCodeAt(i)
        }

        const decompressed = pako.inflate(compressed, { to: 'string' })
        config = JSON.parse(decompressed) as AppConfig
      } catch (decompressError) {
        try {
          // If decompression fails, try parsing as uncompressed base64
          const jsonString = atob(paddedBase64)
          config = JSON.parse(jsonString) as AppConfig
        } catch (parseError) {
          throw new Error(`Failed to parse project data: ${parseError.message}`)
        }
      }

      // Load the config
      await runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          yield* configService.loadConfig(config)
        })
      )

      if (config.project) {
        // Update local reactive state immediately
        await updateCurrentProject()
        toast.success(`Loaded project: ${config.project.name}`)

        // Force another update after a short delay to ensure UI sync
        setTimeout(updateCurrentProject, 100)
      }

      // Clear the URL parameter to clean up the address bar
      url.searchParams.delete('project')
      window.history.replaceState({}, '', url.toString())

      return true
    } catch (error) {
      console.error('Failed to load project from URL:', error)
      toast.error('Failed to load project from URL')
      return false
    }
  }

  /**
   * Clear current project and return to default config
   */
  async function clearProject(): Promise<void> {
    try {
      // Load default config (without project)
      const { default: defaultConfig } = await import('@/../app.config.json')

      await runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          yield* configService.loadConfig(defaultConfig)
        })
      )

      // Update local reactive state immediately
      await updateCurrentProject()
      toast.success('Project cleared')

      // Force another update after a short delay to ensure UI sync
      setTimeout(updateCurrentProject, 100)
    } catch (error) {
      console.error('Failed to clear project:', error)
      toast.error('Failed to clear project')
      throw error
    }
  }

  /**
   * Copy shareable URL to clipboard
   */
  async function copyShareableUrl(): Promise<void> {
    try {
      const url = await generateShareableUrl()
      await navigator.clipboard.writeText(url)
      toast.success('Project URL copied to clipboard')
    } catch (error) {
      console.error('Failed to copy URL:', error)
      toast.error('Failed to copy URL to clipboard')
    }
  }

  // Initialize project state and check for URL on mount
  onMounted(async () => {
    // Always update current project state from ConfigService
    await updateCurrentProject()

    // Check for project in URL only once per app lifecycle
    if (!isInitialized.value) {
      isInitialized.value = true
      await loadProjectFromUrl()
    }

    // Set up periodic refresh to keep UI in sync with ConfigService
    // This is a temporary solution until we have proper reactive state management
    setInterval(updateCurrentProject, 1000)
  })

  return {
    currentProject,
    isProjectMode,
    createProject,
    generateShareableUrl,
    loadProjectFromUrl,
    clearProject,
    copyShareableUrl
  }
}
