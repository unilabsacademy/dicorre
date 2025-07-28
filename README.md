# Ratatoskr - DICOM Anonymizer & Sender

A browser-based tool for anonymizing DICOM files and sending them to radiology destinations via DICOMweb.

## Quick Start

### 1. Start the DICOM Server (Orthanc)

```bash
# Start Orthanc DICOM server
docker-compose up -d

# Check if Orthanc is ready
curl http://localhost:8080/system
```

Access Orthanc web interface at: http://localhost:8080/app/explorer.html

**No authentication required** (disabled for development)

### 2. Start the Development Server

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

The application will be available at: http://localhost:5173

### 3. Test the Application

1. **Get sample DICOM files:**
   - Download from [DICOM Library](https://www.osirix-viewer.com/resources/dicom-image-library/)
   - Or use synthetic test data from [pydicom-data](https://github.com/pydicom/pydicom-data)

2. **Create a ZIP file** containing DICOM files

3. **Use the application:**
   - Drop the ZIP file into the application
   - Click "Anonymize All" to anonymize the DICOM files
   - Click "Test Connection" to verify Orthanc connectivity
   - Click "Send Study" to send anonymized files to Orthanc

## Architecture

### Core Services

- **FileHandler**: ZIP extraction and file validation
- **DicomProcessor**: DICOM parsing with dcmjs, metadata extraction
- **Anonymizer**: DICOM anonymization with @umessen/dicom-deidentifier
- **DicomSender**: DICOMweb STOW-RS sending with dicomweb-client

### Tech Stack

- **Frontend**: Vue 3 + TypeScript + Vite
- **DICOM Processing**: dcmjs
- **Anonymization**: @umessen/dicom-deidentifier
- **DICOM Sending**: dicomweb-client
- **File Handling**: JSZip
- **DICOM Server**: dcm4chee-arc-light

## Configuration

### DICOM Server

Default configuration points to local Orthanc:
- URL: `http://localhost:8080`
- AE Title: `ORTHANC`

### Anonymization

Default profile: `BasicProfile` with private tag removal enabled.

Available profiles:
- `basic`: BasicProfile (retain device identity)
- `clean`: CleanDescOption (remove descriptors)
- `very-clean`: CleanGraphOption (remove graphics)

## Development Commands

```bash
# Type checking
pnpm type-check

# Linting
pnpm lint

# Build for production
pnpm build

# Run tests
pnpm test:unit
```

## Troubleshooting

### Common Issues

1. **Orthanc not starting**: Check `docker-compose logs orthanc` for startup issues
2. **CORS errors**: Orthanc is configured to allow CORS from localhost:5173
3. **Upload fails**: Ensure ZIP contains valid DICOM files with proper magic numbers

### Logs

```bash
# Check Orthanc logs
docker-compose logs orthanc
```

## Security Note

⚠️ **Never use real patient data for testing.** This is a development tool - only use anonymized test datasets or synthetic data.
