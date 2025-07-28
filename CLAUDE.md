# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a browser-based DICOM anonymization and sending tool. Key features:
- Client-side DICOM file processing and anonymization
- DICOMweb-based sending to radiology destinations
- Plugin architecture for format converters
- Project-based configurations for sharing with contributors

## Tech Stack Recommendations

Based on PRD requirements:
- **Language**: Typescript
- **Frontend Framework**: Vue.js for browser-based UI
- **DICOM Processing**: dcmjs library
- **Anonymization**: @umessen/dicom-deidentifier (TypeScript-friendly, standard profiles)
- **DICOM Sending**: dicomweb-client
- **File Handling**: JSZip for unzipping files in browser
- **Build Tool**: Vite

### UI
- We use vue shadcn component system
- Components located in /aca_nuxt/layers/base/components/ui
- Components are auto-imported with Ui prefic (UiButton) but prefer explicit imports except for small common ones like button.
- Component install via shadcn cli currently broken due to folder layout so ask if necessary to install new component

### Styling
- Always use tailwind for styling
- We are currently using tailwind 3 so variables are tracked both in tailwind.css and tailwind.config.js
- Prefer variables in aca_nuxt/layers/base/assets/css/tailwind.css especially for color
- primary-light-gray, secondary-gray and primary-dark-gray most commonly used in UI (sometimes with /50 (50 opacity if subtle change is needed))
- It's ONLY ok to write scoped css in a vue component if there isn't a nice way to solve it with tailwind (like grids with named slots or tables when a @apply utility class can save a lot of duplicates)

## Development Commands

Once the project is initialized, common commands will be:

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint

# Type checking
pnpm type-check

# Run Docker compose for dcm4chee test server
docker-compose up -d
```

## Architecture Guidelines

TODO