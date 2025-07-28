import type { AppConfig, DicomServerConfig, AnonymizationConfig } from '@/types/dicom'
import defaultConfig from '@/../app.config.json'

/**
 * Configuration service that merges build-time defaults with runtime overrides
 */
export class ConfigService {
  private config: AppConfig

  constructor() {
    // Load default configuration from JSON file
    this.config = defaultConfig as AppConfig
  }

  /**
   * Get default DICOM server configuration
   */
  getDefaultServerConfig(): DicomServerConfig {
    return { ...this.config.dicomServer }
  }

  /**
   * Get default anonymization configuration
   */
  getDefaultAnonymizationConfig(): AnonymizationConfig {
    const { tagDescriptions: _tagDescriptions, ...anonymizationConfig } = this.config.anonymization
    return { ...anonymizationConfig }
  }

  /**
   * Get anonymization preset by name
   */
  getAnonymizationPreset(presetName: string): AnonymizationConfig | null {
    const preset = this.config.presets?.[presetName]
    if (!preset) {
      return null
    }

    // Merge preset with base anonymization config
    return {
      ...this.config.anonymization,
      profile: preset.profile,
      removePrivateTags: preset.removePrivateTags
    }
  }

  /**
   * Get all available presets
   */
  getPresets(): Record<string, { profile: string; description: string }> {
    const presets: Record<string, { profile: string; description: string }> = {}
    
    if (this.config.presets) {
      for (const [key, preset] of Object.entries(this.config.presets)) {
        presets[key] = {
          profile: preset.profile,
          description: preset.description
        }
      }
    }
    
    return presets
  }

  /**
   * Process replacement patterns (e.g., {timestamp} -> actual timestamp)
   */
  processReplacements(replacements: Record<string, string>): Record<string, string> {
    const processed: Record<string, string> = {}
    const timestamp = Date.now().toString().slice(-6)
    
    for (const [key, value] of Object.entries(replacements)) {
      if (typeof value === 'string') {
        processed[key] = value.replace('{timestamp}', timestamp)
      }
    }
    
    return processed
  }

  /**
   * Get tag description by tag ID
   */
  getTagDescription(tagId: string): string {
    return this.config.anonymization.tagDescriptions?.[tagId] || tagId
  }

  /**
   * Get list of tags to remove during anonymization
   */
  getTagsToRemove(): string[] {
    return this.config.anonymization.tagsToRemove || []
  }

  /**
   * Get full app configuration (mainly for debugging)
   */
  getFullConfig(): AppConfig {
    return { ...this.config }
  }
}

// Export singleton instance
export const configService = new ConfigService()