# Anonymisation settings form DICOM Deis package:
In previous desktop application we used the python Deid package. These are the settings we used there for reference:

See docs:
https://pydicom.github.io/deid/
https://github.com/pydicom/deid

**Deid file**
```
FORMAT dicom

%header

REMOVE AdditionalPatientHistory
REMOVE startswith:IssueDate
REMOVE IssuerOfPatientID
REMOVE FillerOrderNumberImagingServiceRequest
REMOVE OtherPatientIDs
REMOVE OtherPatientNames
REMOVE OtherPatientIDsSequence
REMOVE PatientAddress
REMOVE PatientBirthName
REMOVE PatientMotherBirthName
REMOVE ReasonForStudy
REMOVE contains:Trial
REMOVE startswith:PatientTelephoneNumber
REMOVE ReferringPhysicianName
REMOVE ConsultingPhysicianName
REMOVE EvaluatorName
REMOVE PerformedStationName
REMOVE SecondaryReviewerName
REMOVE PersonAddress
REMOVE ReferringPhysicianAddress
REMOVE ReferringPhysicianTelephoneNumbers
REMOVE ReferringPhysicianIdentificationSequence
REMOVE ConsultingPhysicianIdentificationSequence
REMOVE PhysicianApprovingInterpretation
REMOVE PhysiciansOfRecord
REMOVE PhysiciansOfRecordIdentificationSequence
REMOVE PerformingPhysicianName
REMOVE PerformingPhysicianIdentificationSequence
REMOVE PhysiciansReadingStudyIdentificationSequence
REMOVE RequestingPhysician
REMOVE ScheduledPerformingPhysicianIdentificationSequence
REMOVE RequestingPhysicianIdentificationSequence
REMOVE HumanPerformerName
REMOVE ContactDisplayName
REMOVE PerformingPhysicianName
REMOVE NameOfPhysiciansReadingStudy
REMOVE OperatorsName
REMOVE ScheduledPerformingPhysicianName
REMOVE ReviewerName
REMOVE NamesOfIntendedRecipientsOfResults
REMOVE SourceApplicatorName
REMOVE ClinicalTrialSponsorName
REMOVE ContentCreatorName
REMOVE ClinicalTrialProtocolEthicsCommitteeName
REMOVE RegionOfResidence
REMOVE CurrentPatientLocation
REMOVE PatientComments
REMOVE PatientTransportArrangements
REMOVE PatientDeathDateInAlternativeCalendar
REMOVE PatientInstitutionResidence
REMOVE PerformedLocation
REMOVE ScheduledStudyLocation
REMOVE ScheduledStudyLocationAETitle
REMOVE OrderEntererLocation
REMOVE AssignedLocation
REMOVE StationName
REMOVE InstitutionalDepartmentName
REMOVE InstitutionAddress
REMOVE InstitutionName

JITTER endswith:Date 31
REPLACE PatientName Anonymous
REPLACE PatientID func:generate_value
REPLACE StudyID func:generate_value
REPLACE AccessionNumber func:generate_value
REPLACE StudyInstanceUID func:generate_value
REPLACE SeriesInstanceUID func:generate_value
REPLACE SOPInstanceUID func:generate_value
ADD PatientIdentityRemoved Yes

```


**Generate functions referenced in deied file**
```python
def generate_uid(self, item, value, field, dicom):
    bigint_uid = str(uuid.uuid4().int)
    full_uid = self.ORG_ROOT + "." + bigint_uid
    sliced_uid = full_uid[0:64]  # A DICOM UID is limited to 64 characters
    return sliced_uid

def generate_accession_number(self, item, value, field, dicom):
    new_acc = 'ACA' + str(random.randint(1000000, 9999999))
    return new_acc

def generate_patient_id(self, item, value, field, dicom):
    if self.single_patient_id and dicom:
        return self.single_patient_id
    new_acc = 'PAT' + str(random.randint(1000000, 9999999))
    return new_acc

def generate_study_id(self, item, value, field, dicom):
    new_stid = 'STID' + str(random.randint(1000000, 9999999))
    return new_stid

def value_generator(self, item, value, field, dicom):
    value = field.element.value
    field_name = field.element.keyword

    if field_name not in self.cache:
        self.cache[field_name] = {}

    if field_name == 'AccessionNumber' and not value:
        value = dicom.StudyInstanceUID

    if value in self.cache[field_name]:
        return self.cache[field_name][value]

    if field_name == 'AccessionNumber':
        new_value = self.generate_accession_number(item, value, field, dicom)
    elif field_name == 'PatientID':
        new_value = self.generate_patient_id(item, value, field, dicom)
    elif field_name == 'StudyID':
        new_value = self.generate_study_id(item, value, field, dicom)
    else:
        new_value = self.generate_uid(item, value, field, dicom)

    self.cache[field_name][value] = new_value

    return new_value
```