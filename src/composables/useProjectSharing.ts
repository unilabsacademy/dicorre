import { inject } from 'vue'
import { Effect, ManagedRuntime } from 'effect'
import pako from 'pako'
import { ConfigService } from '@/services/config'
import type { AppConfig } from '@/services/config/schema'
import { toast } from 'vue-sonner'

export function useProjectSharing() {
  const runtime = inject<ManagedRuntime.ManagedRuntime<any, never>>('appRuntime')
  // if (!runtime) {
  //   throw new Error('App runtime not found. Make sure useProjectSharing is called within a component that has access to the app runtime.')
  // }

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
   * Load config from URL parameter
   * Returns the parsed config if successful, null if no config in URL
   */
  async function loadConfigFromUrl(): Promise<AppConfig | null> {
    try {
      const url = new URL(window.location.href)
      const encodedProject = url.searchParams.get('project')

      if (!encodedProject) {
        return null
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
      } catch (_decompressError) {
        try {
          // If decompression fails, try parsing as uncompressed base64
          const jsonString = atob(paddedBase64)
          config = JSON.parse(jsonString) as AppConfig
        } catch (parseError) {
          throw new Error(`Failed to parse project data: ${parseError instanceof Error ? parseError.message : String(parseError)}`)
        }
      }

      // Clear the URL parameter to clean up the address bar
      url.searchParams.delete('project')
      window.history.replaceState({}, '', url.toString())

      return config
    } catch (error) {
      console.error('Failed to load config from URL:', error)
      toast.error('Failed to load config from URL')
      return null
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

  return {
    generateShareableUrl,
    loadConfigFromUrl,
    copyShareableUrl
  }
}
