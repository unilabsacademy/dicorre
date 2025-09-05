### Anonymization
Files: `src/workers/workerManager.ts`, `src/workers/anonymizationWorker.ts`, `src/services/anonymizer/index.ts`, `src/composables/useAppState.ts`

- **Simplify worker orchestration boundaries**
  - **Problem**: `AnonymizationWorkerManager.prepareJobData` serializes/clones per-file data and passes a bespoke message type; worker then rehydrates OPFS and re-saves under original ids. Duplication of load → anonymize → save concerns across worker and service.
  - **Change**: Move OPFS I/O entirely into worker and treat `Anonymizer.anonymizeStudy` as pure compute. Provide a single worker API: `processStudy({ studyId, fileIds, config, options }) -> { updatedFileIds }`. Main thread should not need file shapes.
  - **Result**: One IO boundary, fewer object conversions, simpler `useAppState.anonymizeSelected`.

- **Unify concurrency knobs**
  - **Problem**: Concurrency appears in multiple layers (worker pool size, worker-side Effect concurrency, anonymizer options). Risk of mismatch.
  - **Change**: Define one concurrency source at entry point; pass through; remove layer-local defaults. Worker controls both pool and internal concurrency.
  - **Result**: Predictable tuning; fewer parameters.

- **Reduce progress signaling duplication**
  - **Problem**: Worker posts progress; anonymizer computes progress; UI computes progress. Three sources.
  - **Change**: Only worker emits progress events; `Anonymizer` returns results only; UI derives from worker events.
  - **Result**: Fewer state sources; simpler UI updates.


### DICOM Sending
Files: `src/composables/useDicomSender.ts`, `src/services/dicomSender/index.ts`, `src/composables/useAppState.ts`

- **Collapse dual sending APIs**
  - **Problem**: `useDicomSender.sendStudyEffect` and service-level `sendFiles` both implement progress/concurrency.
  - **Change**: Keep a single primitive in service (`sendFiles`); composable becomes a thin UI adapter.
  - **Result**: One implementation to maintain.

- **Normalize server config once**
  - **Problem**: `normalizeServerConfig` in composable; similar header/auth logic duplicated inside sender.
  - **Change**: Normalize at `ConfigService` or exclusively in sender; remove duplicates elsewhere.
  - **Result**: Fewer branches; simpler auth handling.

- **Streamline STOW-RS body building**
  - **Problem**: Manual multipart boundary assembly is verbose/brittle.
  - **Change**: Prefer `FormData` with Blob and `Content-Type: application/dicom` per part; if strict `multipart/related` is required, encapsulate boundary assembly in a small reusable helper.
  - **Result**: Less brittle HTTP assembly; clearer separation of concerns.


### File Ingestion and Processing
Files: `src/composables/useFileProcessing.ts`, `src/services/fileHandler/index.ts`, `src/services/dicomProcessor/index.ts`, `src/composables/useDragAndDrop.ts`, `src/App.vue`

- **Merge parse/split/saving into a single effect**
  - **Problem**: `useFileProcessing` orchestrates steps with callbacks; `fileHandler` and `dicomProcessor` split responsibility.
  - **Change**: Create service `ingestFiles(files, options) -> DicomFile[]` that detects → parses/converts → validates → saves to OPFS with a single progress callback. Composable becomes a thin progress container.
  - **Result**: One ingestion API; less callback plumbing.

- **Remove double-read of bytes**
  - **Problem**: Bytes read in `fileHandler` then re-read downstream.
  - **Change**: After first read, pass `ArrayBuffer` forward; write once to OPFS; downstream reuses buffer or loads lazily via `opfsFileId` only when needed.
  - **Result**: Lower memory churn; faster ingestion.

- **Plugin resolution boundary**
  - **Problem**: `fileHandler` queries plugin registry and builds default conversion metadata.
  - **Change**: Introduce `ConversionOrchestrator` owning plugin selection and default metadata; `fileHandler` focuses on reading/zip/DICOM validation.
  - **Result**: Cleaner separation; easier tests.


### Configuration and Project Management
Files: `src/services/config/index.ts`, `src/components/ConfigEditSheet.vue`, `src/components/ConfigLoader.vue`

- **Centralize config normalization**
  - **Problem**: Tag conversion and auth normalization scattered (service and UI).
  - **Change**: `normalizeConfig(AppConfig): AppConfig` inside `ConfigService`, run on load. UI/services consume normalized shapes.
  - **Result**: Consistent config; remove UI-level cleanups.

- **Reduce stream of getters**
  - **Problem**: Multiple getters with overlapping validation paths.
  - **Change**: Maintain `SubscriptionRef<AppConfig>` and derived `NormalizedConfig`; validate only on `loadConfig`; accessors do not revalidate.
  - **Result**: Less repeated validation; simpler call-sites.

- **Simplify project plugin params editing**
  - **Problem**: `ConfigEditSheet` hand-builds nested structures for plugin params.
  - **Change**: Add helper in `ConfigService` to get/set plugin params by id with typed accessors.
  - **Result**: Smaller component code; fewer deep mutations.


### Download/Export
Files: `src/services/downloadService/index.ts`, `src/composables/useDownload.ts`

- **Single entry for packaging**
  - **Problem**: Service mixes filtering and packaging.
  - **Change**: Filter selections in UI; service accepts already-filtered `DicomStudy[]` or operates on `DicomFile[]` with a folder strategy.
  - **Result**: Service is pure packaging; more reusable.

- **Pluggable folder strategy**
  - **Problem**: One baked-in folder structure.
  - **Change**: Introduce `FolderStrategy` parameter with defaults; configurable via UI or config.
  - **Result**: Fewer branches; easier variation.

- **OPFS lookup reduction**
  - **Problem**: Lists all OPFS files then checks membership.
  - **Change**: Accept `opfsFileIds` directly; optionally add strict verify flag.
  - **Result**: Fewer OPFS calls; faster packaging.


### Cross-cutting simplifications

- **Events and progress: choose one publisher**
  - Prefer worker (for anonymization) and service (for sending) as the single progress source. UI should not compute progress independently.

- **Concurrency and batching: one knob per workflow**
  - Single source of truth per workflow; remove deep defaults.

- **Effect layers vs composables**
  - Where composables duplicate a service pipeline, collapse to service primitive; keep composables as thin adapters to Vue state.

- **Data shapes**
  - Use stable `DicomFile` shape with rule: if `opfsFileId` exists, `arrayBuffer` may be omitted and must be lazy-loaded by the consumer that needs bytes.

- **IO boundaries**
  - Keep OPFS exclusively in worker or service, not both and not in UI.
