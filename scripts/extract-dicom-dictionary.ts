#!/usr/bin/env npx tsx

/**
 * Script to extract DICOM tag dictionary from deidentify-reference.ts
 */

import { dicomTagsReference } from '../src/utils/deidentify-reference'

function formatTag(tag: string): string {
  // Convert "(0008,0016)" to "00080016"
  return tag.replace(/[(),,]/g, '').replace(/,/g, '')
}

function createTagDictionary() {
  const tagToName: Record<string, string> = {}
  const nameToTag: Record<string, string> = {}
  
  dicomTagsReference.forEach(item => {
    const hexTag = formatTag(item.Tag)
    const tagName = item["Attribute Name"]
    
    // Create mappings
    tagToName[hexTag] = tagName
    nameToTag[tagName] = hexTag
    
    // Also create mapping with normalized name (spaces to underscores, etc.)
    const normalizedName = tagName
      .replace(/'/g, '')
      .replace(/\s+/g, '')
      .replace(/[-()]/g, '')
      .replace(/\//g, 'Or')
    
    if (normalizedName !== tagName) {
      nameToTag[normalizedName] = hexTag
    }
  })
  
  return { tagToName, nameToTag }
}

const { tagToName, nameToTag } = createTagDictionary()

console.log('📊 DICOM Tag Dictionary Statistics:')
console.log(`- Total tags: ${Object.keys(tagToName).length}`)
console.log(`- Unique tag names: ${Object.keys(nameToTag).length}`)
console.log()

// Look for the tags currently used in our config
const currentConfigTags = [
  "00200013", // Instance Number
  "00080060", // Modality
  "00080070", // Manufacturer
  "00080090", // Referring Physician Name
  "00181030"  // Protocol Name
]

console.log('🔍 Current config tags and their names:')
currentConfigTags.forEach(tag => {
  const name = tagToName[tag]
  if (name) {
    console.log(`- ${tag} → "${name}"`)
  } else {
    console.log(`- ${tag} → NOT FOUND in dictionary`)
  }
})
console.log()

// Output the complete dictionary to a TypeScript file
const outputPath = '../src/utils/dicom-tag-dictionary.ts'
const tsContent = `/**
 * DICOM Tag Dictionary
 * Generated from DICOM deidentification reference data
 * Maps between tag hex values and official DICOM tag names
 */

// Tag hex (e.g., "00080016") to Tag Name (e.g., "SOP Class UID")
export const DICOM_TAG_TO_NAME: Record<string, string> = ${JSON.stringify(tagToName, null, 2)}

// Tag Name (e.g., "SOP Class UID") to Tag hex (e.g., "00080016") 
export const DICOM_NAME_TO_TAG: Record<string, string> = ${JSON.stringify(nameToTag, null, 2)}

/**
 * Get DICOM tag name from hex value
 */
export function getTagName(hexTag: string): string {
  const name = DICOM_TAG_TO_NAME[hexTag.replace(/[(),,]/g, '')]
  if (!name) {
    throw new Error(\`Unknown DICOM tag: \${hexTag}\`)
  }
  return name
}

/**
 * Get DICOM tag hex from name
 */
export function getTagHex(tagName: string): string {
  const hex = DICOM_NAME_TO_TAG[tagName]
  if (!hex) {
    throw new Error(\`Unknown DICOM tag name: \${tagName}\`)
  }
  return hex
}

/**
 * Convert tag name to config-friendly format (hex)
 */
export function tagNameToHex(tagName: string): string {
  return getTagHex(tagName)
}

/**
 * Convert hex tag to human-readable name
 */
export function tagHexToName(hexTag: string): string {
  return getTagName(hexTag)
}

/**
 * Validate if a tag name exists in the dictionary
 */
export function isValidTagName(tagName: string): boolean {
  return tagName in DICOM_NAME_TO_TAG
}

/**
 * Validate if a tag hex exists in the dictionary  
 */
export function isValidTagHex(hexTag: string): boolean {
  return hexTag.replace(/[(),,]/g, '') in DICOM_TAG_TO_NAME
}

/**
 * Get all available tag names
 */
export function getAllTagNames(): string[] {
  return Object.keys(DICOM_NAME_TO_TAG)
}

/**
 * Get all available tag hex values
 */
export function getAllTagHex(): string[] {
  return Object.keys(DICOM_TAG_TO_NAME)
}
`

console.log(`📝 Writing complete DICOM tag dictionary to: ${outputPath}`)
console.log(`   - ${Object.keys(tagToName).length} tag mappings`)
console.log(`   - ${Object.keys(nameToTag).length} name mappings`)

// Write the file (we'll do this in the next step)
console.log()
console.log('✅ Dictionary extraction complete!')
console.log()
console.log('💡 Next steps:')
console.log('1. Create the dictionary file')
console.log('2. Search codebase for hex tag usage')
console.log('3. Update configs to use tag names')
console.log('4. Update validation schemas')