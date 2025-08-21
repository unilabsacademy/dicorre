import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { validateAppConfig, parseAppConfig, AppConfigSchema } from './schema'

describe('Config Schema Validation', () => {
  describe('DicomServerConfig', () => {
    it('should accept valid server config', async () => {
      const config = {
        dicomServer: {
          url: '/api/orthanc/dicom-web',
          headers: { 'X-Custom': 'value' },
          timeout: 30000,
          auth: null,
          description: 'Test server'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      const result = await Effect.runPromise(validateAppConfig(config))
      expect(result).toBeDefined()
      expect(result.dicomServer.url).toBe('/api/orthanc/dicom-web')
    })

    it('should reject config without server URL', async () => {
      const config = {
        dicomServer: {
          headers: {},
          timeout: 30000
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow()
    })

    it('should reject config with invalid URL format', async () => {
      const config = {
        dicomServer: {
          url: 'invalid-url',
          headers: {}
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow(/URL must start with \/ or http/)
    })

    it('should reject config with negative timeout', async () => {
      const config = {
        dicomServer: {
          url: '/api/test',
          timeout: -1000
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow(/Timeout must be positive/)
    })

    it('should reject config with timeout exceeding max', async () => {
      const config = {
        dicomServer: {
          url: '/api/test',
          timeout: 700000
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow(/Timeout must not exceed 600000ms/)
    })
  })

  describe('AnonymizationConfig', () => {
    it('should accept valid anonymization config', async () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['CleanDescOption'],
          removePrivateTags: false,
          dateJitterDays: 30,
          organizationRoot: '1.2.3.4.5',
          replacements: {
            patientName: 'ANONYMOUS',
            patientId: 'ID_{timestamp}'
          },
          preserveTags: ['SOP Class UID', 'SOP Instance UID'],
          tagsToRemove: ['PatientAddress']
        }
      }

      const result = await Effect.runPromise(validateAppConfig(config))
      expect(result.anonymization.profileOptions).toEqual(['CleanDescOption'])
      expect(result.anonymization.dateJitterDays).toBe(30)
    })

    it('should reject invalid profile', async () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['InvalidProfile'],
          removePrivateTags: true
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow()
    })

    it('should reject negative dateJitterDays', async () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true,
          dateJitterDays: -5
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow(/dateJitterDays must be >= 0/)
    })

    it('should reject dateJitterDays > 365', async () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true,
          dateJitterDays: 400
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow(/dateJitterDays must be <= 365/)
    })

    it('should reject invalid tag format in preserveTags', async () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true,
          preserveTags: ['00080016', 'SOP Class UID', 'INVALID', '12345'] // Mix of hex, name, and invalid
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow(/Tag must be a valid DICOM tag name/)
    })

    it('should reject invalid organization root', async () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true,
          organizationRoot: '1.2.abc.4' // Invalid: contains letters
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow(/Organization root must be a valid OID/)
    })
  })


  describe('Complete Config', () => {
    it('should accept the default config structure', async () => {
      const defaultConfig = {
        dicomServer: {
          url: '/api/orthanc/dicom-web',
          headers: {},
          timeout: 30000,
          auth: null,
          description: 'Default DICOM server configuration'
        },
        anonymization: {
          profileOptions: ['BasicProfile', 'RetainLongModifDatesOption', 'RetainUIDsOption'],
          removePrivateTags: true,
          useCustomHandlers: true,
          dateJitterDays: 31,
          organizationRoot: '1.2.826.0.1.3680043.8.498',
          replacements: {
            default: 'REMOVED',
            patientName: 'ANONYMOUS',
            accessionNumber: 'ACA{timestamp}',
            patientId: 'PAT{timestamp}',
            patientBirthDate: '19000101',
            institution: 'ANONYMIZED'
          },
          preserveTags: [
            "Instance Number",
            "Modality", 
            "Manufacturer",
            "Referring Physician's Name",
            "Protocol Name"
          ],
          tagsToRemove: [
            'PatientAddress',
            'PatientTelephoneNumber'
          ]
        }
      }

      const result = await Effect.runPromise(validateAppConfig(defaultConfig))
      expect(result).toBeDefined()
      expect(result.dicomServer.url).toBe('/api/orthanc/dicom-web')
      expect(result.anonymization.profileOptions).toEqual(['BasicProfile', 'RetainLongModifDatesOption', 'RetainUIDsOption'])
    })

    it('should handle missing optional fields', async () => {
      const minimalConfig = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      const result = await Effect.runPromise(validateAppConfig(minimalConfig))
      expect(result).toBeDefined()
      expect(result.dicomServer.headers).toBeUndefined()
      expect(result.anonymization.replacements).toBeUndefined()
    })

    it('should accept mixed hex and tag name formats in preserveTags', async () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true,
          preserveTags: ['00080016', 'Modality', '00200013', 'Manufacturer'] // Mix of hex and names
        }
      }

      const result = await Effect.runPromise(validateAppConfig(config))
      expect(result).toBeDefined()
      expect(result.anonymization.preserveTags).toEqual(['00080016', 'Modality', '00200013', 'Manufacturer'])
    })
  })

  describe('parseAppConfig (sync)', () => {
    it('should parse valid config synchronously', () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      const result = parseAppConfig(config)
      expect(result).toBeDefined()
      expect(result.dicomServer.url).toBe('/api/test')
    })

    it('should throw on invalid config', () => {
      const config = {
        dicomServer: {},
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      expect(() => parseAppConfig(config)).toThrow()
    })
  })
})