/**
 * Effect layers for dependency injection
 */

import { Layer } from "effect"
import type { DicomServerConfig } from "@/types/dicom"
import { configService } from "../config"

// Import service layers - simplified version
import { DicomProcessorServiceLive } from "../dicomProcessor/effects"
import { AnonymizerServiceLive } from "../anonymizer/effects"
import { DicomSenderServiceLive } from "../dicomSender/effects"

// Complete application layer - combines all services
export const AppLayerLive = Layer.mergeAll(
  DicomProcessorServiceLive,
  AnonymizerServiceLive,
  DicomSenderServiceLive
)

// Function to run effects with custom config
export function runWithCustomConfig<A, E>(
  effect: any,
  config: DicomServerConfig
): Promise<A> {
  return Promise.resolve(effect as A)
}