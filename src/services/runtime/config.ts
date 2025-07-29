/**
 * Promise-based ConfigService wrapper for application use
 * This allows current application code to work with Effect services
 * TODO: Update application to use Effect directly and remove this file
 */

import { Effect } from 'effect'
import { ConfigService } from '../config'
import { runWithServices } from '../shared/runtime'
import type { DicomServerConfig, AnonymizationConfig, AppConfig } from '@/types/dicom'

export class ConfigServiceWrapper {
  async getDefaultServerConfig(): Promise<DicomServerConfig> {
    return runWithServices(
      Effect.gen(function* () {
        const service = yield* ConfigService
        return yield* service.getServerConfig
      })
    )
  }

  async getDefaultAnonymizationConfig(): Promise<AnonymizationConfig> {
    return runWithServices(
      Effect.gen(function* () {
        const service = yield* ConfigService
        return yield* service.getAnonymizationConfig
      })
    )
  }

  async getAnonymizationPreset(presetName: string): Promise<AnonymizationConfig> {
    return runWithServices(
      Effect.gen(function* () {
        const service = yield* ConfigService
        return yield* service.getAnonymizationPreset(presetName)
      })
    )
  }

  async getPresets(): Promise<Record<string, { profile: string; description: string }>> {
    return runWithServices(
      Effect.gen(function* () {
        const service = yield* ConfigService
        return yield* service.getPresets
      })
    )
  }
}

export const configService = new ConfigServiceWrapper()