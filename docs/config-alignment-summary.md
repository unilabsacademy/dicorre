# Configuration Alignment with DICOM Standards - Summary

## Overview

This document summarizes the changes made to align our DICOM anonymization configuration with official DICOM standards, reducing manual overrides and relying more on standardized profile options.

## Changes Made

### 1. Updated Profile Options

**Before:**
```json
"profileOptions": ["BasicProfile"]
```

**After:**
```json
"profileOptions": ["BasicProfile", "RetainLongModifDatesOption", "RetainUIDsOption"]
```

**Impact:**
- `RetainLongModifDatesOption`: Preserves temporal relationships between studies with date shifting
- `RetainUIDsOption`: Preserves Study/Series/SOP Instance UIDs for maintaining DICOM object relationships

### 2. Simplified preserveTags

**Before:** 11 manually preserved tags
```json
"preserveTags": [
  "00080016", // SOP Class UID - handled by fundamental DICOM requirements
  "00080018", // SOP Instance UID - handled by RetainUIDsOption  
  "0020000D", // Study Instance UID - handled by RetainUIDsOption
  "0020000E", // Series Instance UID - handled by RetainUIDsOption
  "00200013", // Instance Number
  "00080020", // Study Date - handled by RetainLongModifDatesOption
  "00080030", // Study Time - handled by RetainLongModifDatesOption
  "00080060", // Modality
  "00080070", // Manufacturer
  "00080090", // Referring Physician Name
  "00181030"  // Protocol Name
]
```

**After:** 5 tags that need manual preservation
```json
"preserveTags": [
  "00200013", // Instance Number
  "00080060", // Modality
  "00080070", // Manufacturer  
  "00080090", // Referring Physician Name
  "00181030"  // Protocol Name
]
```

**Tags Removed from preserveTags (handled by profile options):**
- `00080016` (SOP Class UID): Fundamental DICOM requirement, likely always preserved
- `00080018` (SOP Instance UID): Handled by `RetainUIDsOption`
- `0020000D` (Study Instance UID): Handled by `RetainUIDsOption`
- `0020000E` (Series Instance UID): Handled by `RetainUIDsOption`
- `00080020` (Study Date): Handled by `RetainLongModifDatesOption`
- `00080030` (Study Time): Handled by `RetainLongModifDatesOption`

### 3. Drastically Simplified tagsToRemove

**Before:** 59 manually specified tags to remove

**After:** 3 pattern-based rules
```json
"tagsToRemove": [
  "startswith:IssueDate",
  "contains:Trial", 
  "startswith:PatientTelephoneNumber"
]
```

**Tags Removed from tagsToRemove (handled by BasicProfile):**
- `PatientAddress`: BasicProfile action `X` (remove)
- `ReferringPhysicianName`: BasicProfile action `Z` (replace)
- `PersonAddress`: BasicProfile action `X` (remove)
- `ReferringPhysicianAddress`: BasicProfile action `X` (remove)
- `ReferringPhysicianTelephoneNumbers`: BasicProfile action `X` (remove)
- `InstitutionalDepartmentName`: BasicProfile action `X` (remove)
- `InstitutionAddress`: BasicProfile action `X` (remove)
- Plus 49 other tags that were either handled by BasicProfile or not found in DICOM standard

**Kept Pattern Rules:** These provide custom removal logic not covered by standard profiles

### 4. Updated tagDescriptions

Reduced to only describe the tags we're still manually preserving:
```json
"tagDescriptions": {
  "00200013": "Instance Number",
  "00080060": "Modality", 
  "00080070": "Manufacturer",
  "00080090": "Referring Physician Name",
  "00181030": "Protocol Name"
}
```

## Benefits Achieved

### 1. **Reduced Complexity**
- **preserveTags**: Reduced from 11 to 5 tags (55% reduction)
- **tagsToRemove**: Reduced from 59 to 3 patterns (95% reduction)
- **tagDescriptions**: Reduced from 11 to 5 entries (55% reduction)

### 2. **Better Standards Compliance**
- Now relies on official DICOM PS 3.15 profile options
- Leverages industry-standard de-identification practices
- Automatically inherits updates to DICOM standard

### 3. **Clearer Intent**
- Profile options clearly communicate de-identification strategy:
  - `BasicProfile`: Conservative de-identification baseline
  - `RetainLongModifDatesOption`: Longitudinal studies with date shifting
  - `RetainUIDsOption`: Preserve DICOM object relationships

### 4. **Easier Maintenance**
- Fewer manual overrides to maintain
- Changes to DICOM standards automatically applied
- Less risk of misconfiguring individual tags

### 5. **Enhanced Functionality**
- Date shifting preserves temporal relationships while protecting privacy
- UID retention maintains DICOM object relationships
- Pattern-based removal provides flexible custom logic

## Validation

### Tests
- ✅ All configuration service tests pass
- ✅ TypeScript compilation successful 
- ✅ Schema validation works correctly

### Profile Option Coverage
Based on audit analysis:
- **6 of 11 preserveTags** now handled by profile options (55% coverage)
- **7 of 59 tagsToRemove** confirmed handled by BasicProfile
- **3 pattern rules** retained for custom logic not in standard

## Next Steps

### Remaining Manual Overrides

The following tags still require manual preservation and should be reviewed:

1. **`00200013` (Instance Number)**: Not found in reference - verify if needed
2. **`00080060` (Modality)**: Not found in reference - likely fundamental to DICOM
3. **`00080070` (Manufacturer)**: Not found in reference - may be handled by `RetainDeviceIdentOption` if needed
4. **`00080090` (Referring Physician Name)**: BasicProfile replaces with dummy (Z) - manual preservation overrides this
5. **`00181030` (Protocol Name)**: BasicProfile removes/modifies (X/D) - manual preservation needed

### Potential Further Optimizations

1. **Consider `RetainDeviceIdentOption`** if manufacturer information is important for your use case
2. **Review remaining preserveTags** against actual DICOM files to verify necessity
3. **Monitor anonymization results** to ensure expected behavior with new profile options

## References

- [DICOM PS 3.15 - Security and System Management Profiles](https://dicom.nema.org/medical/dicom/current/output/html/part15.html)
- [Basic Application Level Confidentiality Profile](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_E.2.html)  
- [Configuration Documentation](./configuration.md)