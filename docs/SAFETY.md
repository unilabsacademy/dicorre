### Purpose

This document describes our end‑to‑end safety strategy to prevent un‑anonymized data from being sent and to minimize in‑memory retention of potentially PII‑bearing bytes. It also explains our OPFS “single source of truth” model and points to the exact places in the codebase where each safeguard is enforced.

### Goals

- Ensure only anonymized DICOM objects are sent to remote DICOM servers.
- Minimize the lifetime of raw DICOM bytes in memory and avoid duplicating originals on disk.
- Make OPFS the canonical source of DICOM bytes; in‑memory objects are metadata descriptors.
- Provide deterministic, auditable codepaths that can be reviewed and validated.

### Single Source of Truth: OPFS

- OPFS is the canonical store for all DICOM bytes. In‑memory file objects exist for UI/metadata; byte payloads are loaded from OPFS on demand.
- Where to confirm:
  - `src/services/opfsStorage/index.ts`: OPFS API (`saveFile`, `loadFile`, `fileExists`, `deleteFile`, `listFiles`).
  - `src/services/dicomSender/index.ts` `sendFiles`: always reloads bytes from OPFS prior to sending.
  - `src/workers/anonymizationWorker.ts` `anonymizeStudy`: reads originals from OPFS and writes anonymized bytes back under the same logical id.

### Upload → Parse → Persist: Memory Hygiene

- On upload, files are parsed and saved to OPFS; immediately after a successful save we clear the in‑memory `arrayBuffer` and set `opfsFileId`.
- Where to confirm:
  - `src/composables/useFileProcessing.ts` `saveAllToOpfs`: after `saveFile` and `fileExists`, we set `f.opfsFileId = f.id` and `f.arrayBuffer = new ArrayBuffer(0)`.
  - `src/services/dicomProcessor/index.ts` `parseFile/parseFiles`: parsing occurs before OPFS save; post‑save buffers are cleared as above.

### Anonymization Pipeline

- Worker thread loads source bytes from OPFS, applies anonymization, then overwrites the OPFS object with anonymized bytes.
- The worker returns file descriptors with empty `arrayBuffer` (main thread reloads if needed); this prevents anonymized bytes from lingering in worker/main memory.
- Where to confirm:
  - `src/workers/anonymizationWorker.ts` `anonymizeStudy`: loads via `OPFSStorage.loadFile`, uses `Anonymizer.anonymizeStudy`, saves with `OPFSStorage.saveFile`, optionally deletes any previous `opfsFileId`, marks `file.anonymized = true`, and posts back with `arrayBuffer` cleared.
  - `src/services/anonymizer/index.ts` `anonymizeFile/anonymizeStudy`: transformation of tags and re‑parse to update metadata.

### Post‑Anonymization Rebuild

- After anonymization completes, the UI refreshes the study model from the returned anonymized file descriptors. In‑memory files keep `arrayBuffer` empty and reflect new metadata.
- Where to confirm:
  - `src/composables/useAppState.ts` `anonymizeSelected` completion handler: replaces matching entries in `dicomFiles` with anonymized descriptors and calls `rebuildStudyAfterAnonymization`.
  - `src/services/dicomProcessor/index.ts` `groupFilesByStudy`: used to rebuild studies from anonymized descriptors.

### Enforcement: “Anonymized‑only” Sending

- UI layer selects only `file.anonymized === true` when building the send list for a study.
- Sender layer defensively rejects any non‑anonymized file and always reloads OPFS bytes before send.
- Where to confirm:
  - `src/composables/useAppState.ts` `handleSendSelected`: filters `study.series.flatMap(...).filter(file => file.anonymized)`.
  - `src/services/dicomSender/index.ts` `sendFiles`: rejects non‑anonymized input and loads bytes from OPFS for each file before `sendFile`.
  - `src/services/dicomSender/index.ts` `sendFile`: validates presence of payload and SOP Instance UID and performs STOW‑RS upload.

### Session Persistence: No Byte Reloads

- Session restore does not reload bytes into memory; it reconstructs file descriptors with empty `arrayBuffer` and `opfsFileId`, leaving OPFS as the source for any future reads.
- Where to confirm:
  - `src/services/sessionPersistence/index.ts` `restore`: pushes restored file descriptors with `arrayBuffer = new ArrayBuffer(0)` and `opfsFileId = meta.id`.
  - `src/services/sessionPersistence/index.ts` `persist`: best‑effort ensures OPFS has objects for new files but does not keep raw bytes in localStorage.

### Deletion and Lifecycle

- Clearing selected studies removes their files from the in‑memory model and best‑effort deletes their OPFS objects to avoid lingering PII.
- Where to confirm:
  - `src/composables/useAppState.ts` `clearSelected`: for each removed file, calls `OPFSStorage.deleteFile(file.id)` best‑effort before dropping it from `dicomFiles`.
  - `src/services/opfsStorage/index.ts` `deleteFile` and `clearAllFiles`: deletion primitives.

### Why sending always uses the anonymized file

- The anonymization worker overwrites OPFS using the logical file id (`file.id`) and returns descriptors with empty buffers.
- The sender always reloads bytes from OPFS at `sendFiles` time, guaranteeing the bytes sent are the canonical, last‑written anonymized bytes.
- Where to confirm:
  - `src/workers/anonymizationWorker.ts` (overwrite under `targetId = file.id`).
  - `src/services/dicomSender/index.ts` `sendFiles` (always `loadFile(file.id)` before `sendFile`).

### Residual Risks and Mitigations

- Plugin conversions may derive metadata from the original filename (e.g., `Study Description`). Mitigation: anonymizer config must remove/override such fields.
  - Where to review: `src/services/fileHandler/index.ts` conversion defaults; `src/services/anonymizer/index.ts` + anonymization config loader.
- Logging: Study logs persist messages in localStorage; content must avoid PII.
  - Where to review: `src/services/studyLogger/index.ts`, `src/services/studyLogger/persistence.ts`.
- Optional pre‑send validation: add a check for `PatientIdentityRemoved = YES` and redacted `PatientName` to fail fast if anonymization config is misapplied.
  - Integration point: `src/services/dicomSender/index.ts` prior to `sendFile`.

### Operational Summary (behaviors to validate)

1) Upload
- Saved to OPFS; memory cleared per file descriptor.
- Confirm in: `useFileProcessing.ts` `saveAllToOpfs`.

2) Anonymize
- Loads from OPFS, writes anonymized bytes back to same logical id, returns descriptors without bytes.
- Confirm in: `anonymizationWorker.ts` `anonymizeStudy`.

3) Send
- UI chooses anonymized files only; sender rejects non‑anonymized and reloads OPFS bytes.
- Confirm in: `useAppState.ts` `handleSendSelected` and `dicomSender/index.ts` `sendFiles`.

4) Restore / Clear
- Restore builds descriptors with empty buffers; clear removes OPFS files for selected studies.
- Confirm in: `sessionPersistence/index.ts` `restore`, `useAppState.ts` `clearSelected`.

### Quick Review Checklist

- OPFS is written before buffers are cleared? See `useFileProcessing.ts` `saveAllToOpfs`.
- Post‑anonymization, OPFS is overwritten and buffers stripped? See `anonymizationWorker.ts` completion.
- Any path can send non‑anonymized? Check `useAppState.ts` selection + `dicomSender/index.ts` guard.
- Send bytes always match OPFS? See `dicomSender/index.ts` `sendFiles` reload logic.
- Session restore ever fills buffers? Check `sessionPersistence/index.ts` `restore`.
- Clearing studies deletes OPFS objects? See `useAppState.ts` `clearSelected`.

### References (by file/function)

- `src/services/opfsStorage/index.ts`: `saveFile`, `loadFile`, `fileExists`, `deleteFile`, `clearAllFiles`
- `src/composables/useFileProcessing.ts`: `saveAllToOpfs`
- `src/workers/anonymizationWorker.ts`: `anonymizeStudy` (load→anonymize→save→strip buffers)
- `src/services/anonymizer/index.ts`: `anonymizeFile`, `anonymizeStudy`
- `src/composables/useAppState.ts`: `anonymizeSelected`, `handleSendSelected`, `clearSelected`
- `src/services/dicomSender/index.ts`: `sendFiles`, `sendFile`
- `src/services/sessionPersistence/index.ts`: `persist`, `restore`
- `src/services/dicomProcessor/index.ts`: `parseFile`, `parseFiles`, `groupFilesByStudy`
- `src/services/studyLogger/index.ts`, `src/services/studyLogger/persistence.ts`


