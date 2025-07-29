/**
 * Promise-based FileHandler wrapper for application use
 * This allows current application code to work with Effect services
 * TODO: Update application to use Effect directly and remove this file
 */

import { Effect } from 'effect'
import { FileHandler } from '../fileHandler'
import { runWithServices } from '../shared/runtime'
import type { DicomFile } from '@/types/dicom'

export class FileHandlerWrapper {
  async extractZipFile(file: File): Promise<DicomFile[]> {
    return runWithServices(
      Effect.gen(function* () {
        const service = yield* FileHandler
        return yield* service.extractZipFile(file)
      })
    )
  }

  async readSingleDicomFile(file: File): Promise<DicomFile> {
    return runWithServices(
      Effect.gen(function* () {
        const service = yield* FileHandler
        return yield* service.readSingleDicomFile(file)
      })
    )
  }

  async validateDicomFile(arrayBuffer: ArrayBuffer, fileName: string): Promise<boolean> {
    return runWithServices(
      Effect.gen(function* () {
        const service = yield* FileHandler
        return yield* service.validateDicomFile(arrayBuffer, fileName)
      })
    )
  }
}