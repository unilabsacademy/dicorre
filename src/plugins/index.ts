import { Effect } from "effect"
import { PluginRegistry } from '@/services/pluginRegistry'
import { imageConverterPlugin } from './imageConverter'
import { pdfConverterPlugin } from './pdfConverter'
import { sendLoggerPlugin } from './sendLogger'
import { sentNotifierPlugin } from './sentNotifier'
import type { PluginConfig } from '@/types/plugins'

/**
 * Plugin loader - registers all available plugins with the registry
 */
export const loadPlugins = (config?: PluginConfig) =>
  Effect.gen(function* () {
    const registry = yield* PluginRegistry

    console.log('Loading plugins...')

    // Load plugin configuration if provided
    if (config) {
      yield* registry.loadPluginConfig(config)
    }

    // Register built-in plugins
    const plugins = [
      imageConverterPlugin,
      pdfConverterPlugin,
      sendLoggerPlugin,
      sentNotifierPlugin
    ]

    // Register each plugin
    for (const plugin of plugins) {
      yield* registry.registerPlugin(plugin).pipe(
        Effect.catchAll((error) =>
          Effect.succeed(console.error(`Failed to register plugin ${plugin.id}:`, error))
        )
      )
    }

    // Get registered plugins for confirmation
    const registeredPlugins = yield* registry.getAllPlugins()
    console.log(`Successfully loaded ${registeredPlugins.length} plugins:`,
      registeredPlugins.map(p => `${p.name} (${p.id})`).join(', ')
    )

    return registeredPlugins
  })

/**
 * Initialize plugins with default configuration
 */
export const initializePlugins = () => loadPlugins()
