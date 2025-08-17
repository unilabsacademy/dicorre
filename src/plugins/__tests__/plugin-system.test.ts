import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { PluginRegistry, PluginRegistryLive } from '@/services/pluginRegistry'
import { imageConverterPlugin } from '../imageConverter'
import { sendLoggerPlugin } from '../sendLogger'
import { initializePlugins } from '../index'

describe('Plugin System', () => {
  const runTest = <A, E>(effect: Effect.Effect<A, E, PluginRegistry>) =>
    Effect.runPromise(effect.pipe(Effect.provide(PluginRegistryLive)))

  describe('Plugin Registry', () => {
    it('should register plugins', async () => {
      const result = await runTest(Effect.gen(function* () {
        const registry = yield* PluginRegistry
        
        // Register plugins
        yield* registry.registerPlugin(imageConverterPlugin)
        yield* registry.registerPlugin(sendLoggerPlugin)
        
        // Get all plugins
        const plugins = yield* registry.getAllPlugins()
        return plugins
      }))
      
      expect(result).toHaveLength(2)
      expect(result.map(p => p.id)).toContain('image-converter')
      expect(result.map(p => p.id)).toContain('send-logger')
    })

    it('should get plugins by type', async () => {
      const result = await runTest(Effect.gen(function* () {
        const registry = yield* PluginRegistry
        
        // Try to register plugins (may already be registered)
        yield* registry.registerPlugin(imageConverterPlugin).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        )
        yield* registry.registerPlugin(sendLoggerPlugin).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        )
        
        // Get plugins by type
        const fileFormatPlugins = yield* registry.getFileFormatPlugins()
        const hookPlugins = yield* registry.getHookPlugins()
        
        return { fileFormatPlugins, hookPlugins }
      }))
      
      expect(result.fileFormatPlugins.length).toBeGreaterThanOrEqual(1)
      expect(result.fileFormatPlugins.some(p => p.id === 'image-converter')).toBe(true)
      
      expect(result.hookPlugins.length).toBeGreaterThanOrEqual(1)
      expect(result.hookPlugins.some(p => p.id === 'send-logger')).toBe(true)
    })

    it('should find plugin for supported files', async () => {
      const jpgFile = new File(['fake jpg data'], 'test.jpg', { type: 'image/jpeg' })
      const dcmFile = new File(['fake dcm data'], 'test.dcm')
      
      const result = await runTest(Effect.gen(function* () {
        const registry = yield* PluginRegistry
        
        // Try to register image converter plugin (may already be registered)
        yield* registry.registerPlugin(imageConverterPlugin).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        )
        
        // Test file detection
        const jpgPlugin = yield* registry.getPluginForFile(jpgFile)
        const dcmPlugin = yield* registry.getPluginForFile(dcmFile)
        
        return { jpgPlugin, dcmPlugin }
      }))
      
      expect(result.jpgPlugin?.id).toBe('image-converter')
      expect(result.dcmPlugin).toBeUndefined() // No plugin should handle DCM files
    })

    it('should load plugin configuration', async () => {
      const config = {
        enabled: ['image-converter'],
        settings: {
          'image-converter': {
            defaultModality: 'CT'
          }
        }
      }
      
      await runTest(Effect.gen(function* () {
        const registry = yield* PluginRegistry
        
        // Try to register plugin first (may already be registered)
        yield* registry.registerPlugin(imageConverterPlugin).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        )
        
        // Load configuration
        yield* registry.loadPluginConfig(config)
        
        // Plugin should be enabled
        const plugins = yield* registry.getFileFormatPlugins()
        expect(plugins[0].enabled).toBe(true)
      }))
    })
  })

  describe('Plugin Loading', () => {
    it('should initialize plugins with default config', async () => {
      const result = await runTest(Effect.gen(function* () {
        // Initialize plugins
        const plugins = yield* initializePlugins()
        return plugins
      }))
      
      expect(result).toHaveLength(2)
      expect(result.map(p => p.id)).toContain('image-converter')
      expect(result.map(p => p.id)).toContain('send-logger')
    })
  })

  describe('Image Converter Plugin', () => {
    it('should identify supported image files', async () => {
      const jpgFile = new File(['fake jpg data'], 'test.jpg', { type: 'image/jpeg' })
      const pngFile = new File(['fake png data'], 'test.png', { type: 'image/png' })
      const txtFile = new File(['text data'], 'test.txt', { type: 'text/plain' })
      
      const jpgResult = await Effect.runPromise(imageConverterPlugin.canProcess(jpgFile))
      const pngResult = await Effect.runPromise(imageConverterPlugin.canProcess(pngFile))
      const txtResult = await Effect.runPromise(imageConverterPlugin.canProcess(txtFile))
      
      expect(jpgResult).toBe(true)
      expect(pngResult).toBe(true)
      expect(txtResult).toBe(false)
    })
  })

  describe('Send Logger Plugin', () => {
    it('should have proper hook structure', () => {
      expect(sendLoggerPlugin.hooks.afterSend).toBeDefined()
      expect(sendLoggerPlugin.hooks.beforeSend).toBeDefined()
      expect(sendLoggerPlugin.hooks.onSendError).toBeDefined()
    })
  })
})