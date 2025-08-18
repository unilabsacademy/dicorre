#!/usr/bin/env npx tsx

/**
 * Script to find all hex tag usage throughout the codebase
 */

import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { isValidTagHex, getTagName } from '../src/utils/dicom-tag-dictionary'

function findHexTags() {
  const results: Array<{
    file: string
    line: number
    content: string
    hexTag: string
    tagName?: string
  }> = []

  // Find all source files with hex patterns
  const command = `find /Users/victornyberg/Work/TMC/Ratatoskr -name "*.ts" -o -name "*.js" -o -name "*.vue" -o -name "*.json" | grep -v node_modules | grep -v .git | grep -v .mypy_cache | xargs grep -n "[0-9A-Fa-f]\\{8\\}"`
  
  try {
    const output = execSync(command, { encoding: 'utf-8' })
    const lines = output.split('\n').filter(line => line.trim())
    
    for (const line of lines) {
      const match = line.match(/^([^:]+):(\d+):(.+)$/)
      if (!match) continue
      
      const [, file, lineNum, content] = match
      
      // Extract all 8-character hex patterns from the line
      const hexMatches = content.match(/[0-9A-Fa-f]{8}/g)
      if (!hexMatches) continue
      
      for (const hexTag of hexMatches) {
        // Skip if it's obviously not a DICOM tag (like dates, IDs, etc.)
        if (hexTag === '19000101' || hexTag === '20000101' || hexTag.startsWith('1234')) {
          continue
        }
        
        let tagName: string | undefined
        try {
          if (isValidTagHex(hexTag)) {
            tagName = getTagName(hexTag)
          }
        } catch {
          // Not a valid DICOM tag
        }
        
        results.push({
          file: file.replace('/Users/victornyberg/Work/TMC/Ratatoskr/', ''),
          line: parseInt(lineNum),
          content: content.trim(),
          hexTag,
          tagName
        })
      }
    }
  } catch (error) {
    console.error('Error running search:', error)
  }
  
  return results
}

const results = findHexTags()

// Group by file
const byFile = results.reduce((acc, result) => {
  if (!acc[result.file]) {
    acc[result.file] = []
  }
  acc[result.file].push(result)
  return acc
}, {} as Record<string, typeof results>)

console.log('🔍 DICOM Hex Tag Usage Throughout Codebase\n')

// Summary statistics
const validTags = results.filter(r => r.tagName)
const unknownTags = results.filter(r => !r.tagName)

console.log('📊 Summary:')
console.log(`- Files with hex tags: ${Object.keys(byFile).length}`)
console.log(`- Total hex occurrences: ${results.length}`)
console.log(`- Valid DICOM tags: ${validTags.length}`)
console.log(`- Unknown/Invalid tags: ${unknownTags.length}`)
console.log()

// Show by file
for (const [file, fileResults] of Object.entries(byFile)) {
  const validInFile = fileResults.filter(r => r.tagName)
  const unknownInFile = fileResults.filter(r => !r.tagName)
  
  console.log(`📁 ${file}`)
  console.log(`   Valid DICOM tags: ${validInFile.length}, Unknown: ${unknownInFile.length}`)
  
  // Show valid DICOM tags
  if (validInFile.length > 0) {
    console.log('   Valid tags:')
    for (const result of validInFile) {
      console.log(`     Line ${result.line}: ${result.hexTag} → "${result.tagName}"`)
    }
  }
  
  // Show unknown tags (might need verification)
  if (unknownInFile.length > 0) {
    console.log('   Unknown tags:')
    for (const result of unknownInFile) {
      console.log(`     Line ${result.line}: ${result.hexTag} (${result.content.substring(0, 50)}...)`)
    }
  }
  
  console.log()
}

// Create a unique list of all valid DICOM tags used
const uniqueValidTags = [...new Set(validTags.map(r => r.hexTag))]
console.log('📋 All Unique Valid DICOM Tags Used:')
uniqueValidTags.forEach(tag => {
  try {
    const name = getTagName(tag)
    console.log(`- ${tag} → "${name}"`)
  } catch {
    console.log(`- ${tag} → UNKNOWN`)
  }
})

console.log()
console.log('💡 Next Steps:')
console.log('1. Replace hex tags in configuration files with tag names')
console.log('2. Update source code to use tag name constants')
console.log('3. Create validation for tag names in schemas')
console.log('4. Update tests to use tag names')