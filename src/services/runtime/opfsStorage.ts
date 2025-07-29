/**
 * Promise-based OPFSStorage wrapper for application use
 * This allows current application code to work with Effect services
 * TODO: Update application to use Effect directly and remove this file
 */

import { Effect } from 'effect'
import { OPFSStorage } from '../opfsStorage'
import { runWithServices } from '../shared/runtime'

export class OPFSStorageWrapper {
  async saveFile(fileId: string, arrayBuffer: ArrayBuffer): Promise<void> {
    return runWithServices(
      Effect.gen(function* () {
        const service = yield* OPFSStorage
        return yield* service.saveFile(fileId, arrayBuffer)
      })
    )
  }

  async loadFile(fileId: string): Promise<ArrayBuffer> {
    return runWithServices(
      Effect.gen(function* () {
        const service = yield* OPFSStorage
        return yield* service.loadFile(fileId)
      })
    )
  }

  async deleteFile(fileId: string): Promise<void> {
    return runWithServices(
      Effect.gen(function* () {
        const service = yield* OPFSStorage
        return yield* service.deleteFile(fileId)
      })
    )
  }

  async listFiles(): Promise<string[]> {
    return runWithServices(
      Effect.gen(function* () {
        const service = yield* OPFSStorage
        return yield* service.listFiles
      })
    )
  }

  async clearAllFiles(): Promise<void> {
    return runWithServices(
      Effect.gen(function* () {
        const service = yield* OPFSStorage
        return yield* service.clearAllFiles
      })
    )
  }

  async getStorageInfo(): Promise<{ used: number; quota: number }> {
    return runWithServices(
      Effect.gen(function* () {
        const service = yield* OPFSStorage
        return yield* service.getStorageInfo
      })
    )
  }
}

export const opfsStorage = new OPFSStorageWrapper()