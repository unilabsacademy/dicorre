# Anonymise and Send

## Description
- This is a tool for anonymising DICOM files before sending them to a radiology destination.
- Anonymisation happens in browser, on device, before images get transmitted.
- When a user drops a zip file into the app the files get processed and exams are displayed in a table.
- The settings for which DICOM tags get anonymised and in what way is configurable but starts with strong defaults.
- Tool is also extendable to convert other formats to DICOM before sending such as other image formats, PDF and even video files.
- Format converters are defined as plugin modules and possibly the DICOM processor is also defined as a separate module.
- Software should support plugin architecture to perform certain tasks as specific events like after or before sending a case.
- There needs to be the ability to create a scenario where radiology destination and other configuration is pre-set for easily sharing a link to a doctor wanting to upload cases. We will call these scenarios "projects".

## User flow
- User clicks button to add or drops ZIP file with dicom exams in application
- Zip file gets unzipped and all files are processed and displayed
- Exams are listed in a table with DICOM data sortable by patient ID and other relevant columns
- Exams are selectable in the list
- Exams can be anonymised in list by selecting and clicking a button
- Exams can be sent to a DICOM server from the list
- The sending of exams (DICOM) files to the destination is tracked with progress bar per each case

## Authantication and roles
- Two roles will considered:
    - Admin
    - Contributor
- Admin has full access to change settings and configuration
- A contributor only has access to specific projects and cannot change settings or config
- Admin grants a contributor access by sharing a link with a key to a specific project
- For a first version we will only require simple password authentication for each role (no username).

## Dicom sending
- DICOM destination configurable
- Only supports DICOMweb

### Packages to consider for sending DICOM files
**dicomweb-client**
Repository: https://github.com/ImagingDataCommons/dicomweb-client
Docs: https://dicomweb-client.readthedocs.io/en/latest/usage.html

## Anonymisation

### Packages to consider for anonymisation:

In order of relevance:

**Dicom-deidentifier-ts**
https://github.com/UMEssen/dicom-deidentifier-ts
- TypeScript projects requiring type safety
- Standard DICOM anonymization profiles
- Simpler, more straightforward API usage
- Projects that don't need scripting capabilities

**dicom-curate**
https://github.com/bebbi/dicom-curate
- More suitable for clinical-trial flows but could work for our scenario.
- Standardized anonymization following DICOM PS3.15
- Subject ID mapping from spreadsheets
- File organization based on DICOM metadata
- Validation of data integrity
- Consistent handling across multiple batches

**Dicomedit**
https://github.com/WoonchanCho/dicomedit
- Conditional logic based on tag values
- Complex pattern matching across nested sequences
- Preservation of DICOM hierarchical relationships
- Debugging capabilities
- Integration with existing XNAT/DicomBrowser workflows

Comparison table:

| Feature | dicomedit | @umessen/dicom-deidentifier | dicom-curate |
|---------|-----------|---------------------------|--------------|
| **Approach** | Scripting language | Profile-based config | Configuration object |
| **File Organization** | ❌ | ❌ | ✅ Built-in |
| **Batch Processing** | ✅ | ❌ | ✅ Advanced |
| **CSV Mapping** | ❌ | ❌ | ✅ Built-in |
| **Conditional Logic** | ✅ Advanced | ❌ | ✅ Limited |
| **PS3.15 Compliance** | ❌ | ✅ Basic | ✅ Comprehensive |
| **UID Hashing** | ✅ | ❌ | ✅ Multiple options |
| **Validation** | ❌ | ❌ | ✅ Built-in |
| **TypeScript** | ❌ | ✅ | ✅ |
| **Private Tag Handling** | ✅ Wildcards | ✅ Basic | ✅ Quarantine |
| **Temporal Offset** | ❌ | ❌ | ✅ |

## DICOM processing

### Packages to consider for dicom processing:
**dcmjs**
https://github.com/dcmjs-org/dcmjs
- Support reading and writing of correct DICOM objects in JavaScript for browser or node environments
- Provide a programmer-friendly JavaScript environment for using and manipulating DICOM objects
- Include a set of useful demos to encourage correct usage of dcmjs and modern DICOM objects
- Encourage correct referencing of instances and composite context when creating derived objects
- Current target is modern web browsers, but a set of node-based utilities also makes sense someday


## Development setup
- We want to be able to simulate a real scenario with DICOM server
- dcm4chee should be used in a Docker container as destination for development
- DICOM files for testing various scenarios should be present in project


## Notes to assess from meeting
- Meta-data for alternative formats
    - Best ui? Pre / post drop?
- Mentor upload tracking (need backend?)
- ICL (interesting case library), export as zip and drop in tool