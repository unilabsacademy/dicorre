import { Effect } from "effect"
import type { HookPlugin, PluginHooks } from '@/types/plugins'
import type { DicomStudy } from '@/types/dicom'
import { PluginError } from '@/types/effects'

/**
 * Send Logger Plugin
 * Simple plugin that logs information to the console after a study has been sent
 */
export class SendLoggerPlugin implements HookPlugin {
  id = 'send-logger'
  name = 'Send Logger'
  version = '1.0.0'
  description = 'Logs study information to console after successful send'
  type = 'hook' as const
  enabled = true

  hooks: PluginHooks = {
    /**
     * Called after a study has been successfully sent
     */
    afterSend: (study: DicomStudy): Effect.Effect<void, PluginError> =>
      Effect.gen(function* () {
        const timestamp = new Date().toISOString()
        const fileCount = study.series.reduce((total, series) => total + series.files.length, 0)
        
        // Create a formatted log message
        const logMessage = [
          '╔══════════════════════════════════════════════════════════════╗',
          '║                    STUDY SENT SUCCESSFULLY                    ║',
          '╠══════════════════════════════════════════════════════════════╣',
          `║ Timestamp:        ${timestamp.padEnd(43)} ║`,
          `║ Patient Name:     ${(study.patientName || 'Unknown').padEnd(43)} ║`,
          `║ Patient ID:       ${(study.patientId || 'Unknown').padEnd(43)} ║`,
          `║ Accession Number: ${(study.accessionNumber || 'N/A').padEnd(43)} ║`,
          `║ Study UID:        ${study.studyInstanceUID.substring(0, 43).padEnd(43)} ║`,
          `║ Study Date:       ${(study.studyDate || 'Unknown').padEnd(43)} ║`,
          `║ Study Desc:       ${(study.studyDescription || 'N/A').substring(0, 43).padEnd(43)} ║`,
          `║ Series Count:     ${study.series.length.toString().padEnd(43)} ║`,
          `║ Total Files:      ${fileCount.toString().padEnd(43)} ║`,
          '╠══════════════════════════════════════════════════════════════╣',
          '║ Series Details:                                               ║'
        ]

        // Add series information
        study.series.forEach((series, index) => {
          logMessage.push(
            `║   ${(index + 1).toString().padStart(2)}. ${(series.modality || 'UNK').padEnd(5)} - ${(series.seriesDescription || 'No description').substring(0, 30).padEnd(30)} (${series.files.length} files)  ║`
          )
        })

        logMessage.push('╚══════════════════════════════════════════════════════════════╝')

        // Log to console
        console.log('\n' + logMessage.join('\n') + '\n')

        // Also log a simpler version for quick reference
        console.log(`✅ SendLogger: Study sent - Patient: ${study.patientName} (${study.patientId}), Files: ${fileCount}`)
      }),

    /**
     * Called before a study is sent
     */
    beforeSend: (study: DicomStudy): Effect.Effect<void, PluginError> =>
      Effect.gen(function* () {
        const fileCount = study.series.reduce((total, series) => total + series.files.length, 0)
        console.log(`📤 SendLogger: Preparing to send study - Patient: ${study.patientName} (${study.patientId}), Files: ${fileCount}`)
      }),

    /**
     * Called if send fails
     */
    onSendError: (study: DicomStudy, error: Error): Effect.Effect<void, PluginError> =>
      Effect.gen(function* () {
        const fileCount = study.series.reduce((total, series) => total + series.files.length, 0)
        
        console.error('╔══════════════════════════════════════════════════════════════╗')
        console.error('║                      STUDY SEND FAILED                        ║')
        console.error('╠══════════════════════════════════════════════════════════════╣')
        console.error(`║ Patient: ${(study.patientName || 'Unknown').padEnd(52)} ║`)
        console.error(`║ Study UID: ${study.studyInstanceUID.substring(0, 50).padEnd(50)} ║`)
        console.error(`║ Files: ${fileCount.toString().padEnd(54)} ║`)
        console.error(`║ Error: ${error.message.substring(0, 54).padEnd(54)} ║`)
        console.error('╚══════════════════════════════════════════════════════════════╝')
        
        console.error(`❌ SendLogger: Failed to send study - ${error.message}`)
      })
  }
}

// Export singleton instance
export const sendLoggerPlugin = new SendLoggerPlugin()