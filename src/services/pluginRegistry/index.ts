import { Effect, Context, Layer } from "effect"
import type { Plugin, FileFormatPlugin, HookPlugin, PluginConfig } from '@/types/plugins'
import { isFileFormatPlugin, isHookPlugin } from '@/types/plugins'
import { PluginError, type PluginErrorType } from '@/types/effects'

/**
 * Plugin Registry Service
 * Manages plugin registration, discovery, and lifecycle
 */
export class PluginRegistry extends Context.Tag("PluginRegistry")<
  PluginRegistry,
  {
    readonly registerPlugin: (plugin: Plugin) => Effect.Effect<void, PluginErrorType>
    readonly unregisterPlugin: (pluginId: string) => Effect.Effect<void, PluginErrorType>
    readonly getPlugin: (pluginId: string) => Effect.Effect<Plugin | undefined, never>
    readonly getAllPlugins: () => Effect.Effect<Plugin[], never>
    readonly getFileFormatPlugins: () => Effect.Effect<FileFormatPlugin[], never>
    readonly getHookPlugins: () => Effect.Effect<HookPlugin[], never>
    readonly getPluginForFile: (file: File) => Effect.Effect<FileFormatPlugin | undefined, PluginErrorType>
    readonly enablePlugin: (pluginId: string) => Effect.Effect<void, PluginErrorType>
    readonly disablePlugin: (pluginId: string) => Effect.Effect<void, PluginErrorType>
    readonly loadPluginConfig: (config: PluginConfig) => Effect.Effect<void, PluginErrorType>
  }
>() { }

/**
 * Internal implementation
 */
class PluginRegistryImpl {
  private static plugins = new Map<string, Plugin>()
  private static enabledPlugins = new Set<string>()
  private static pluginConfig: PluginConfig = { enabled: [] }

  /**
   * Register a new plugin
   */
  static registerPlugin = (plugin: Plugin): Effect.Effect<void, PluginErrorType> =>
    Effect.gen(function* () {
      if (PluginRegistryImpl.plugins.has(plugin.id)) {
        return yield* Effect.fail(new PluginError({
          message: `Plugin with ID '${plugin.id}' is already registered`,
          pluginId: plugin.id
        }))
      }

      console.log(`Registering plugin: ${plugin.name} (${plugin.id}) v${plugin.version}`)
      PluginRegistryImpl.plugins.set(plugin.id, plugin)

      // Check if plugin should be enabled based on config
      if (PluginRegistryImpl.pluginConfig.enabled.includes(plugin.id)) {
        PluginRegistryImpl.enabledPlugins.add(plugin.id)
        plugin.enabled = true
        console.log(`Plugin ${plugin.id} auto-enabled from config`)
      }
    })

  /**
   * Unregister a plugin
   */
  static unregisterPlugin = (pluginId: string): Effect.Effect<void, PluginErrorType> =>
    Effect.gen(function* () {
      if (!PluginRegistryImpl.plugins.has(pluginId)) {
        return yield* Effect.fail(new PluginError({
          message: `Plugin with ID '${pluginId}' is not registered`,
          pluginId
        }))
      }

      PluginRegistryImpl.plugins.delete(pluginId)
      PluginRegistryImpl.enabledPlugins.delete(pluginId)
      console.log(`Unregistered plugin: ${pluginId}`)
    })

  /**
   * Get a specific plugin by ID
   */
  static getPlugin = (pluginId: string): Effect.Effect<Plugin | undefined, never> =>
    Effect.sync(() => PluginRegistryImpl.plugins.get(pluginId))

  /**
   * Get all registered plugins
   */
  static getAllPlugins = (): Effect.Effect<Plugin[], never> =>
    Effect.sync(() => Array.from(PluginRegistryImpl.plugins.values()))

  /**
   * Get all file format plugins
   */
  static getFileFormatPlugins = (): Effect.Effect<FileFormatPlugin[], never> =>
    Effect.sync(() => {
      const plugins = Array.from(PluginRegistryImpl.plugins.values())
      return plugins.filter(isFileFormatPlugin).filter(p => p.enabled !== false)
    })

  /**
   * Get all hook plugins
   */
  static getHookPlugins = (): Effect.Effect<HookPlugin[], never> =>
    Effect.sync(() => {
      const plugins = Array.from(PluginRegistryImpl.plugins.values())
      return plugins.filter(isHookPlugin).filter(p => p.enabled !== false)
    })

  /**
   * Find a plugin that can handle a specific file
   */
  static getPluginForFile = (file: File): Effect.Effect<FileFormatPlugin | undefined, PluginErrorType> =>
    Effect.gen(function* () {
      const fileFormatPlugins = yield* PluginRegistryImpl.getFileFormatPlugins()
      
      // Check by file extension
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase()
      
      for (const plugin of fileFormatPlugins) {
        // Check if extension is supported
        if (plugin.supportedExtensions.some(ext => ext.toLowerCase() === fileExtension)) {
          // Verify with canProcess method
          const canProcess = yield* plugin.canProcess(file)
          if (canProcess) {
            console.log(`Found plugin ${plugin.id} for file ${file.name}`)
            return plugin
          }
        }

        // Check by MIME type if available
        if (plugin.supportedMimeTypes && file.type) {
          if (plugin.supportedMimeTypes.includes(file.type)) {
            const canProcess = yield* plugin.canProcess(file)
            if (canProcess) {
              console.log(`Found plugin ${plugin.id} for file ${file.name} by MIME type`)
              return plugin
            }
          }
        }
      }

      return undefined
    })

  /**
   * Enable a plugin
   */
  static enablePlugin = (pluginId: string): Effect.Effect<void, PluginErrorType> =>
    Effect.gen(function* () {
      const plugin = PluginRegistryImpl.plugins.get(pluginId)
      if (!plugin) {
        return yield* Effect.fail(new PluginError({
          message: `Plugin with ID '${pluginId}' is not registered`,
          pluginId
        }))
      }

      PluginRegistryImpl.enabledPlugins.add(pluginId)
      plugin.enabled = true
      console.log(`Enabled plugin: ${pluginId}`)
    })

  /**
   * Disable a plugin
   */
  static disablePlugin = (pluginId: string): Effect.Effect<void, PluginErrorType> =>
    Effect.gen(function* () {
      const plugin = PluginRegistryImpl.plugins.get(pluginId)
      if (!plugin) {
        return yield* Effect.fail(new PluginError({
          message: `Plugin with ID '${pluginId}' is not registered`,
          pluginId
        }))
      }

      PluginRegistryImpl.enabledPlugins.delete(pluginId)
      plugin.enabled = false
      console.log(`Disabled plugin: ${pluginId}`)
    })

  /**
   * Load plugin configuration
   */
  static loadPluginConfig = (config: PluginConfig): Effect.Effect<void, PluginErrorType> =>
    Effect.sync(() => {
      PluginRegistryImpl.pluginConfig = config
      
      // Update enabled status for all plugins
      for (const [pluginId, plugin] of PluginRegistryImpl.plugins.entries()) {
        if (config.enabled.includes(pluginId)) {
          PluginRegistryImpl.enabledPlugins.add(pluginId)
          plugin.enabled = true
        } else {
          PluginRegistryImpl.enabledPlugins.delete(pluginId)
          plugin.enabled = false
        }
      }
      
      console.log(`Loaded plugin config: ${config.enabled.length} plugins enabled`)
    })
}

/**
 * Live implementation layer
 */
export const PluginRegistryLive = Layer.succeed(
  PluginRegistry,
  PluginRegistry.of({
    registerPlugin: PluginRegistryImpl.registerPlugin,
    unregisterPlugin: PluginRegistryImpl.unregisterPlugin,
    getPlugin: PluginRegistryImpl.getPlugin,
    getAllPlugins: PluginRegistryImpl.getAllPlugins,
    getFileFormatPlugins: PluginRegistryImpl.getFileFormatPlugins,
    getHookPlugins: PluginRegistryImpl.getHookPlugins,
    getPluginForFile: PluginRegistryImpl.getPluginForFile,
    enablePlugin: PluginRegistryImpl.enablePlugin,
    disablePlugin: PluginRegistryImpl.disablePlugin,
    loadPluginConfig: PluginRegistryImpl.loadPluginConfig
  })
)