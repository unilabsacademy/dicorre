#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "pydicom",
# ]
# ///

import pydicom
import sys
from pathlib import Path

def inspect_dicom(file_path):
    """Inspect a DICOM file and print its metadata."""
    try:
        # Read the DICOM file
        ds = pydicom.dcmread(file_path)
        
        print(f"=== DICOM File Inspection: {Path(file_path).name} ===\n")
        
        # Basic info
        print("Basic Information:")
        print(f"  File Meta Information Group Length: {getattr(ds, 'file_meta', {}).get('FileMetaInformationGroupLength', 'N/A')}")
        print(f"  Transfer Syntax: {getattr(ds.file_meta, 'TransferSyntaxUID', 'N/A')}")
        print(f"  SOP Class: {getattr(ds, 'SOPClassUID', 'N/A')}")
        print(f"  SOP Instance: {getattr(ds, 'SOPInstanceUID', 'N/A')}")
        
        # Patient info
        print("\nPatient Information:")
        print(f"  Patient Name: {getattr(ds, 'PatientName', 'N/A')}")
        print(f"  Patient ID: {getattr(ds, 'PatientID', 'N/A')}")
        print(f"  Patient Birth Date: {getattr(ds, 'PatientBirthDate', 'N/A')}")
        print(f"  Patient Sex: {getattr(ds, 'PatientSex', 'N/A')}")
        
        # Study info
        print("\nStudy Information:")
        print(f"  Study Date: {getattr(ds, 'StudyDate', 'N/A')}")
        print(f"  Study Time: {getattr(ds, 'StudyTime', 'N/A')}")
        print(f"  Study Description: {getattr(ds, 'StudyDescription', 'N/A')}")
        print(f"  Study Instance UID: {getattr(ds, 'StudyInstanceUID', 'N/A')}")
        
        # Series info
        print("\nSeries Information:")
        print(f"  Series Date: {getattr(ds, 'SeriesDate', 'N/A')}")
        print(f"  Series Time: {getattr(ds, 'SeriesTime', 'N/A')}")
        print(f"  Series Description: {getattr(ds, 'SeriesDescription', 'N/A')}")
        print(f"  Series Instance UID: {getattr(ds, 'SeriesInstanceUID', 'N/A')}")
        print(f"  Series Number: {getattr(ds, 'SeriesNumber', 'N/A')}")
        
        # Check for potentially problematic tags
        print("\nChecking for potential issues:")
        
        # Check if file has proper DICOM preamble
        if hasattr(ds, 'preamble'):
            print(f"  DICOM Preamble: Present")
        else:
            print(f"  DICOM Preamble: Missing")
            
        # Check for private tags
        private_tags = [elem for elem in ds if elem.tag.group & 0x0001]
        print(f"  Private Tags Count: {len(private_tags)}")
        
        # List all top-level attributes
        print("\nAll Data Elements (first 50):")
        count = 0
        for elem in ds:
            if count >= 50:
                print("  ... (truncated)")
                break
            try:
                value = elem.value
                if isinstance(value, bytes):
                    value = f"<binary data, {len(value)} bytes>"
                elif len(str(value)) > 100:
                    value = str(value)[:100] + "..."
                print(f"  {elem.tag} {elem.keyword}: {value}")
            except:
                print(f"  {elem.tag} {elem.keyword}: <error reading value>")
            count += 1
            
        # Check for sequences that might cause issues
        print("\nSequence Elements:")
        for elem in ds:
            if elem.VR == "SQ":
                print(f"  {elem.tag} {elem.keyword}: Sequence with {len(elem.value)} items")
                
        # Check specific tags that might be undefined
        print("\nChecking specific tags that might cause 'undefined' errors:")
        tags_to_check = [
            (0x0008, 0x0018),  # SOP Instance UID
            (0x0010, 0x0010),  # Patient Name
            (0x0010, 0x0020),  # Patient ID
            (0x0020, 0x000D),  # Study Instance UID
            (0x0020, 0x000E),  # Series Instance UID
        ]
        
        for tag in tags_to_check:
            try:
                elem = ds.get(tag)
                if elem is None:
                    print(f"  Tag {tag}: Not present")
                elif not hasattr(elem, 'Value'):
                    print(f"  Tag {tag}: Present but no Value attribute")
                else:
                    print(f"  Tag {tag}: OK ({elem.keyword})")
            except Exception as e:
                print(f"  Tag {tag}: Error - {e}")
                
    except Exception as e:
        print(f"Error reading DICOM file: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python inspect_dicom.py <dicom_file>")
        sys.exit(1)
        
    inspect_dicom(sys.argv[1])