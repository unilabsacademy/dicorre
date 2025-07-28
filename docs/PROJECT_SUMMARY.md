![](ratatoskr-logo.png){ width=250px }

# Ratatoskr: Browser-Based DICOM Anonymizer & Sender

## Project Overview

Ratatoskr is a privacy-first, browser-based tool that enables medical professionals to anonymize and send DICOM medical imaging files. Named after the Norse mythological messenger squirrel, it facilitates secure communication of medical images between healthcare providers while ensuring patient privacy through robust client-side anonymization.

## Purpose

The purpose of Ratatoskr is to streamline the case processing workload for the Unilabs Academy operations team. It aims to greatly facilitate the process of:

- Collecting images from external collaborators
- Ensuring correct and consistent anonymisation of DICOM images
- Sending cases to the external PACScenter image viewer
- Ensuring cases uploaded to PACScenter automatically get assigned to the correct course in Django

### Core Functionality

- **Client-Side DICOM Processing**: Validates and parses DICOM files entirely within the browser
- **Comprehensive Anonymization**: Removes patient identifiers using industry-standard configurable profiles
- **Secure Transmission**: Sends anonymized data to DICOM servers using the modern DICOMweb transfer protocol
- **Intuitive Interface**: Drag-and-drop file upload with clear visualization of studies, series, and anonymization status
- **Extensive file format support**: Automatically converts other image formats, PDF and video files to DICOM files
- **Easy integration with external systems**: Perform actions before or after sending cases by tying into web-hooks
- **Upload invite links**: Easily invite external collaborators to anonymise and send medical images with pre-configured settings

### Technical Highlights

- Built with Vue 3, TypeScript, and Vite for a modern, performant web application
- Leverages industry standard libraries for DICOM anonyisation end transmission
- Modular architecture with separate services for file handling, processing, anonymization, and sending
- No server-side processing of patient data - all sensitive operations occur in the browser

## Why Open Source Makes Perfect Sense

### 1. **Trust Through Transparency**
Medical professionals handling sensitive patient data need absolute confidence that anonymization happens as promised. Open source allows anyone to:
- Verify that all anonymization occurs client-side before any data transmission
- Audit the specific anonymization algorithms and profiles being applied
- Confirm no patient data is logged, stored, or transmitted to third parties

### 2. **Community-Driven Security**
- Security researchers and healthcare IT professionals can review the code for vulnerabilities
- The medical imaging community can contribute improvements to anonymization techniques
- Rapid identification and patching of potential privacy issues through community oversight

### 3. **Avoiding Licensing Conflicts**
The medical imaging ecosystem involves numerous standards and libraries:
- DICOM standard implementations
- Various JavaScript libraries (dcmjs, JSZip, etc.)
- Healthcare-specific anonymization libraries
Open sourcing ensures compatibility with these dependencies and allows organizations to verify license compliance for their specific use cases.

### 4. **Customization for Specific Needs**
Different healthcare organizations have varying requirements:
- Custom anonymization rules based on local regulations (HIPAA, GDPR, etc.)
- Integration with specific PACS systems or workflows
- Additional format converters or plugins
Open source enables institutions to adapt the tool to their exact needs while contributing improvements back to the community.

### 5. **Compliance and Auditability**
Healthcare regulations often require detailed documentation of data handling:
- Open source provides complete visibility into data flow
- Auditors can review exact anonymization procedures
- Compliance teams can verify that implementations meet regulatory requirements

## Conclusion

Ratatoskr exemplifies how open source principles align perfectly with healthcare technology needs. By making the code publicly available, we ensure that medical professionals can share imaging data with complete confidence in patient privacy, while fostering a community that continuously improves medical data handling practices. The transparency inherent in open source is not just beneficial but essential when dealing with sensitive medical information.