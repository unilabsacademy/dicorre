import { 
  DicomDeidentifier, 
  BasicProfile, 
  CleanDescOption,
  CleanGraphOption,
  RetainDeviceIdentOption 
} from '@umessen/dicom-deidentifier'
import type { DicomFile, AnonymizationConfig } from '@/types/dicom'
import { DicomProcessor } from './dicomProcessor'
import { configService } from './config'
import { getAllSpecialHandlers } from './anonymizationHandlers'

export class Anonymizer {
  private dicomProcessor: DicomProcessor

  constructor() {
    this.dicomProcessor = new DicomProcessor()
  }

  async anonymizeFile(file: DicomFile, config: AnonymizationConfig): Promise<DicomFile> {
    try {
      console.log(`Starting anonymization of file: ${file.fileName}`)
      
      // Select profile based on config
      let profileOptions: any[] = []
      switch (config.profile) {
        case 'clean':
          profileOptions = [CleanDescOption]
          break
        case 'very-clean':
          profileOptions = [CleanGraphOption]
          break
        case 'basic':
        default:
          profileOptions = [BasicProfile]
          break
      }

      // Get processed replacements (with timestamp substitution)
      const processedReplacements = configService.processReplacements(
        (config.replacements || {}) as Record<string, string>
      )

      // Configure deidentifier options
      const deidentifierConfig = {
        profileOptions: profileOptions,
        dummies: {
          default: processedReplacements.default || 'REMOVED',
          lookup: {
            // Use config replacements with fallbacks
            '00100010': processedReplacements.patientName || 'ANONYMOUS', // Patient Name
            '00100020': processedReplacements.patientId || `PAT${Date.now().toString().slice(-6)}`, // Patient ID  
            '00100030': processedReplacements.patientBirthDate || '19000101', // Patient Birth Date
            '00080080': processedReplacements.institution || 'ANONYMIZED', // Institution Name
            // Add any custom replacements
            ...config.customReplacements
          }
        },
        keep: config.preserveTags || [
          // Default essential technical tags for image interpretation
          '00080016', // SOP Class UID
          '00080018', // SOP Instance UID
          '0020000D', // Study Instance UID
          '0020000E', // Series Instance UID
          '00200013', // Instance Number
        ]
      }

      // Add option to remove private tags if requested
      if (config.removePrivateTags) {
        deidentifierConfig.profileOptions.push(RetainDeviceIdentOption)
      }

      // Add custom special handlers if enabled
      if (config.useCustomHandlers) {
        const tagsToRemove = config.tagsToRemove || configService.getTagsToRemove()
        const specialHandlers = getAllSpecialHandlers(config.dateJitterDays || 31, tagsToRemove)
        // @ts-expect-error - specialHandlers property may not be in official types
        deidentifierConfig.specialHandlers = specialHandlers
      }

      // Create deidentifier instance
      let deidentifier: any
      try {
        deidentifier = new DicomDeidentifier(deidentifierConfig)
        console.log(`Created deidentifier for ${file.fileName} with ${config.useCustomHandlers ? 'custom' : 'standard'} handlers`)
      } catch (deidentifierError) {
        console.error(`Failed to create deidentifier:`, deidentifierError)
        throw new Error(`Cannot create anonymizer: ${deidentifierError}`)
      }

      // Convert ArrayBuffer to Uint8Array for the deidentifier
      const uint8Array = new Uint8Array(file.arrayBuffer)
      console.log(`Converted to Uint8Array for ${file.fileName}, size: ${uint8Array.length}`)

      // Anonymize the raw DICOM file
      let anonymizedUint8Array: Uint8Array
      try {
        anonymizedUint8Array = deidentifier.deidentify(uint8Array)
        console.log(`Deidentified ${file.fileName} using library, result size: ${anonymizedUint8Array.length}`)
      } catch (deidentifyError) {
        console.error(`Library deidentification failed:`, deidentifyError)
        throw new Error(`Cannot anonymize file: ${deidentifyError}`)
      }

      // Convert back to ArrayBuffer
      const anonymizedArrayBuffer = anonymizedUint8Array.buffer.slice(
        anonymizedUint8Array.byteOffset,
        anonymizedUint8Array.byteOffset + anonymizedUint8Array.byteLength
      )

      // Return new file with anonymized data
      const anonymizedFile: DicomFile = {
        ...file,
        arrayBuffer: anonymizedArrayBuffer,
        anonymized: true
      }

      // Re-parse to update metadata
      try {
        const finalFile = this.dicomProcessor.parseDicomFile(anonymizedFile)
        console.log(`Successfully anonymized ${file.fileName}`)
        return finalFile
      } catch (reparseError) {
        console.error(`Failed to reparse anonymized file:`, reparseError)
        // Return the anonymized file even if reparse fails
        return anonymizedFile
      }
    } catch (error) {
      console.error(`Error anonymizing file ${file.fileName}:`, error)
      throw new Error(`Failed to anonymize file: ${file.fileName}`)
    }
  }

  async anonymizeFiles(files: DicomFile[], config: AnonymizationConfig): Promise<DicomFile[]> {
    const promises = files.map(file => this.anonymizeFile(file, config))
    return Promise.all(promises)
  }


  private createDummyLookup(): Record<string, string> {
    // Create a simple lookup table for consistent anonymization
    const lookup: Record<string, string> = {}
    let patientCounter = 1
    
    return new Proxy(lookup, {
      get(target, prop: string) {
        if (typeof prop === 'string' && !target[prop]) {
          // Generate consistent anonymous values
          if (prop.includes('Patient')) {
            target[prop] = `ANON${patientCounter++}`
          } else {
            target[prop] = `REMOVED`
          }
        }
        return target[prop]
      }
    })
  }
}