/**
 * Custom special handlers for @umessen/dicom-deidentifier
 * Replicates functionality from Python deid package
 */

// Note: Using any type for DicomElement as the library types may be incomplete
type DicomElement = any

// Cache for consistent value generation within a single study
// Key is studyId, value is a map of field->originalValue->newValue
const studyValueCache = new Map<string, Map<string, Map<string, string>>>()

/**
 * Generate a DICOM UID with organization root
 */
function generateUID(): string {
  // Using a sample organization root - should be configured per deployment
  const ORG_ROOT = '1.2.826.0.1.3680043.8.498'

  // Generate a UUID-based identifier
  const uuid = crypto.randomUUID().replace(/-/g, '')
  const bigintUid = parseInt(uuid.substring(0, 16), 16).toString()

  const fullUid = `${ORG_ROOT}.${bigintUid}`

  // DICOM UID is limited to 64 characters
  return fullUid.substring(0, 64)
}

/**
 * Generate accession number
 */
function generateAccessionNumber(): string {
  const randomNum = Math.floor(Math.random() * (9999999 - 1000000 + 1)) + 1000000
  return `ACA${randomNum}`
}

/**
 * Generate patient ID
 */
function generatePatientID(): string {
  const randomNum = Math.floor(Math.random() * (9999999 - 1000000 + 1)) + 1000000
  return `PAT${randomNum}`
}

/**
 * Generate study ID
 */
function generateStudyID(): string {
  const randomNum = Math.floor(Math.random() * (9999999 - 1000000 + 1)) + 1000000
  return `STID${randomNum}`
}

/**
 * Get cached value or generate new one for a specific study
 */
function getCachedValue(fieldName: string, originalValue: string, studyId: string): string {
  if (!studyValueCache.has(studyId)) {
    studyValueCache.set(studyId, new Map())
  }

  const studyCache = studyValueCache.get(studyId)!
  
  if (!studyCache.has(fieldName)) {
    studyCache.set(fieldName, new Map())
  }

  const fieldCache = studyCache.get(fieldName)!

  if (fieldCache.has(originalValue)) {
    return fieldCache.get(originalValue)!
  }

  let newValue: string

  switch (fieldName) {
    case 'AccessionNumber':
      newValue = generateAccessionNumber()
      break
    case 'PatientID':
      newValue = generatePatientID()
      break
    case 'StudyID':
      newValue = generateStudyID()
      break
    case 'StudyInstanceUID':
    case 'SeriesInstanceUID':
    case 'SOPInstanceUID':
      newValue = generateUID()
      break
    default:
      newValue = generateUID()
  }

  fieldCache.set(originalValue, newValue)
  return newValue
}

/**
 * Parse DICOM date string (YYYYMMDD) to Date object
 */
function parseDicomDate(dateStr: string): Date | null {
  if (!dateStr || dateStr.length !== 8) return null

  const year = parseInt(dateStr.substring(0, 4))
  const month = parseInt(dateStr.substring(4, 6)) - 1 // Month is 0-indexed
  const day = parseInt(dateStr.substring(6, 8))

  if (isNaN(year) || isNaN(month) || isNaN(day)) return null

  return new Date(year, month, day)
}

/**
 * Format Date object to DICOM date string (YYYYMMDD)
 */
function formatDicomDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')

  return `${year}${month}${day}`
}

/**
 * Apply date jitter (random offset in days)
 */
function applyDateJitter(dateStr: string, maxDays: number): string {
  const date = parseDicomDate(dateStr)
  if (!date) return dateStr

  // Generate random offset between -maxDays and +maxDays (excluding 0)
  let offset = Math.floor(Math.random() * (2 * maxDays + 1)) - maxDays
  if (offset === 0) {
    offset = Math.random() > 0.5 ? 1 : -1
  }

  const jitteredDate = new Date(date)
  jitteredDate.setDate(date.getDate() + offset)

  return formatDicomDate(jitteredDate)
}

/**
 * Check if tag name matches pattern
 */
function matchesPattern(tagName: string, pattern: string): boolean {
  if (pattern.startsWith('startswith:')) {
    return tagName.startsWith(pattern.substring(11))
  }
  if (pattern.startsWith('endswith:')) {
    return tagName.endsWith(pattern.substring(9))
  }
  if (pattern.startsWith('contains:')) {
    return tagName.includes(pattern.substring(9))
  }
  return tagName === pattern
}

/**
 * Special handler for removing tags based on patterns
 * @param tagsToRemove Array of tag patterns to remove
 */
export function createRemoveTagsHandler(tagsToRemove: string[] = []) {
  return (element: DicomElement, options: any) => {
    // Try different ways to get the tag name based on library implementation
    const tagName = element.keyword || element.name || element.tag?.toString() || ''

    // Check if this tag should be removed
    for (const pattern of tagsToRemove) {
      if (matchesPattern(tagName, pattern)) {
        // Try different methods to delete/remove the element
        if (element.delete) {
          element.delete()
        } else if (element.remove) {
          element.remove()
        } else {
          // Fallback: set empty value
          element.value = ''
        }
        return true // Skip further processing
      }
    }

    return false // Continue with default processing
  }
}

/**
 * Special handler for date jittering
 */
export function createDateJitterHandler(maxDays: number = 31) {
  return (element: DicomElement, options: any) => {
    const tagName = element.keyword || element.name || ''
    const vr = element.vr || element.VR

    // Apply jitter to date fields ending with 'Date'
    if (tagName.endsWith('Date') && vr === 'DA') {
      const originalValue = element.value || element.getValue?.()
      if (typeof originalValue === 'string' && originalValue.length === 8) {
        const jitteredValue = applyDateJitter(originalValue, maxDays)
        if (element.setValue) {
          element.setValue(jitteredValue)
        } else {
          element.value = jitteredValue
        }
        return true // Skip further processing
      }
    }

    return false // Continue with default processing
  }
}

/**
 * Special handler for value replacements
 */
export function createValueReplacementHandler(studyId: string) {
  return (element: DicomElement, options: any) => {
    const tagName = element.keyword || element.name || ''
    const tagNumber = element.tag?.toString() || ''
    const originalValue = element.value || element.getValue?.()

    if (typeof originalValue !== 'string') return false

    let newValue: string | null = null

    // Match by keyword name or DICOM tag number
    switch (tagName) {
      case 'PatientName':
        newValue = 'Anonymous'
        break
      case 'PatientID':
        newValue = getCachedValue('PatientID', originalValue, studyId)
        break
      case 'StudyID':
        newValue = getCachedValue('StudyID', originalValue, studyId)
        break
      case 'AccessionNumber':
        // Use StudyInstanceUID as fallback if AccessionNumber is empty
        const keyValue = originalValue || originalValue // Simplified for now
        newValue = getCachedValue('AccessionNumber', keyValue, studyId)
        break
      case 'StudyInstanceUID':
        newValue = getCachedValue('StudyInstanceUID', originalValue, studyId)
        break
      case 'SeriesInstanceUID':
        newValue = getCachedValue('SeriesInstanceUID', originalValue, studyId)
        break
      case 'SOPInstanceUID':
        newValue = getCachedValue('SOPInstanceUID', originalValue, studyId)
        break
    }

    // Also check by DICOM tag number if name didn't match
    if (!newValue) {
      switch (tagNumber) {
        case '00100010': // Patient Name
          newValue = 'Anonymous'
          break
        case '00100020': // Patient ID
          newValue = getCachedValue('PatientID', originalValue, studyId)
          break
        case '0020000D': // Study Instance UID
          newValue = getCachedValue('StudyInstanceUID', originalValue, studyId)
          break
        case '0020000E': // Series Instance UID
          newValue = getCachedValue('SeriesInstanceUID', originalValue, studyId)
          break
        case '00080018': // SOP Instance UID
          newValue = getCachedValue('SOPInstanceUID', originalValue, studyId)
          break
        case '00080050': // Accession Number
          newValue = getCachedValue('AccessionNumber', originalValue, studyId)
          break
      }
    }

    if (newValue) {
      if (element.setValue) {
        element.setValue(newValue)
      } else {
        element.value = newValue
      }
      return true // Skip further processing
    }

    return false // Continue with default processing
  }
}

/**
 * Special handler to add PatientIdentityRemoved tag
 */
export function createAddTagsHandler() {
  return (element: DicomElement, options: any) => {
    // This would typically be handled at the dataset level
    // For now, we'll let the anonymizer handle this through configuration
    return false
  }
}

/**
 * Clear the value cache for a specific study
 */
export function clearStudyCache(studyId: string) {
  studyValueCache.delete(studyId)
}

/**
 * Clear the value cache (useful for testing or new sessions)
 */
export function clearValueCache() {
  studyValueCache.clear()
}

/**
 * Get all special handlers as an array
 */
export function getAllSpecialHandlers(jitterDays: number = 31, tagsToRemove: string[] = [], studyId: string = 'default') {
  return [
    createRemoveTagsHandler(tagsToRemove),
    createDateJitterHandler(jitterDays),
    createValueReplacementHandler(studyId),
    createAddTagsHandler()
  ]
}
