import { Schema } from "effect"
import type { AppConfig, DicomServerConfig, AnonymizationConfig, DicomProfileOption } from '@/types/dicom'

// DicomServerConfig Schema
const DicomServerAuthSchema = Schema.Struct({
  type: Schema.Literal("basic", "bearer"),
  credentials: Schema.String
})

export const DicomServerConfigSchema = Schema.Struct({
  url: Schema.String.pipe(
    Schema.minLength(1, { message: () => "DICOM server URL is required" }),
    Schema.filter((url) => url.startsWith("/") || url.startsWith("http"), {
      message: () => "URL must start with / or http"
    })
  ),
  headers: Schema.optional(Schema.Any),
  timeout: Schema.optional(Schema.Number.pipe(
    Schema.greaterThan(0, { message: () => "Timeout must be positive" }),
    Schema.lessThanOrEqualTo(600000, { message: () => "Timeout must not exceed 600000ms (10 minutes)" })
  )),
  auth: Schema.optional(Schema.NullOr(DicomServerAuthSchema)),
  description: Schema.optional(Schema.String)
}).pipe(
  Schema.annotations({
    identifier: "DicomServerConfig",
    description: "DICOM server configuration"
  })
)

// DICOM Profile Options Schema - based on @umessen/dicom-deidentifier standard
const DicomProfileOptionSchema = Schema.Literal(
  "BasicProfile",
  "RetainLongModifDatesOption",
  "RetainLongFullDatesOption",
  "RetainUIDsOption",
  "CleanGraphOption",
  "RetainPatientCharsOption",
  "RetainSafePrivateOption",
  "CleanDescOption",
  "RetainDeviceIdentOption",
  "RetainInstIdentOption",
  "CleanStructContOption"
)

// AnonymizationConfig Schema
const AnonymizationProfileOptionsSchema = Schema.Array(DicomProfileOptionSchema).pipe(
  Schema.minItems(1, { message: () => "At least one profile option is required" }),
  Schema.annotations({
    description: "Array of DICOM standard profile options. BasicProfile is always available as fallback."
  })
)

const ReplacementsSchema = Schema.Struct({
  default: Schema.optional(Schema.String),
  patientName: Schema.optional(Schema.String),
  patientId: Schema.optional(Schema.String),
  accessionNumber: Schema.optional(Schema.String),
  patientBirthDate: Schema.optional(Schema.String),
  institution: Schema.optional(Schema.String)
}).pipe(
  Schema.annotations({
    description: "Replacement patterns for DICOM tags. Can use {timestamp} placeholder"
  })
)

export const AnonymizationConfigSchema = Schema.Struct({
  removePrivateTags: Schema.Boolean,
  profileOptions: AnonymizationProfileOptionsSchema,
  replacements: Schema.optional(ReplacementsSchema),
  preserveTags: Schema.optional(Schema.Array(Schema.String.pipe(
    Schema.filter((tag) => /^[0-9A-Fa-f]{8}$/.test(tag), {
      message: () => "Tag must be 8 hex characters (e.g., 00080016)"
    })
  ))),
  tagsToRemove: Schema.optional(Schema.Array(Schema.String)),
  customReplacements: Schema.optional(Schema.Any),
  dateJitterDays: Schema.optional(Schema.Number.pipe(
    Schema.greaterThanOrEqualTo(0, { message: () => "dateJitterDays must be >= 0" }),
    Schema.lessThanOrEqualTo(365, { message: () => "dateJitterDays must be <= 365" })
  )),
  useCustomHandlers: Schema.optional(Schema.Boolean),
  organizationRoot: Schema.optional(Schema.String.pipe(
    Schema.filter((oid) => /^[0-9.]+$/.test(oid), {
      message: () => "Organization root must be a valid OID (digits and dots only)"
    })
  ))
})

// AnonymizationPreset Schema - removed

// Complete AppConfig Schema
export const AppConfigSchema = Schema.Struct({
  dicomServer: DicomServerConfigSchema,
  anonymization: Schema.Struct({
    removePrivateTags: Schema.Boolean,
    profileOptions: AnonymizationProfileOptionsSchema,
    replacements: Schema.optional(ReplacementsSchema),
    preserveTags: Schema.optional(Schema.Array(Schema.String.pipe(
      Schema.filter((tag) => /^[0-9A-Fa-f]{8}$/.test(tag), {
        message: () => "Tag must be 8 hex characters (e.g., 00080016)"
      })
    ))),
    tagsToRemove: Schema.optional(Schema.Array(Schema.String)),
    customReplacements: Schema.optional(Schema.Any),
    dateJitterDays: Schema.optional(Schema.Number.pipe(
      Schema.greaterThanOrEqualTo(0, { message: () => "dateJitterDays must be >= 0" }),
      Schema.lessThanOrEqualTo(365, { message: () => "dateJitterDays must be <= 365" })
    )),
    useCustomHandlers: Schema.optional(Schema.Boolean),
    organizationRoot: Schema.optional(Schema.String.pipe(
      Schema.filter((oid) => /^[0-9.]+$/.test(oid), {
        message: () => "Organization root must be a valid OID (digits and dots only)"
      })
    )),
    tagDescriptions: Schema.optional(Schema.Any)
  })
})

// Type extraction
export type ValidatedAppConfig = Schema.Schema.Type<typeof AppConfigSchema>
export type AppConfigInput = Schema.Schema.Encoded<typeof AppConfigSchema>

// Validation function that returns Effect
export const validateAppConfig = (input: unknown) => 
  Schema.decodeUnknown(AppConfigSchema)(input)

// Parse function that throws on error (for simpler integration)
export const parseAppConfig = Schema.decodeUnknownSync(AppConfigSchema)

// Encode function to convert back to JSON-safe format
export const encodeAppConfig = Schema.encodeSync(AppConfigSchema)