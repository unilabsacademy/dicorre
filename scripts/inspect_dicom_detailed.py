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

def inspect_tag_details(ds, tag_tuple):
    """Inspect a specific tag in detail."""
    try:
        elem = ds.get(tag_tuple)
        if elem is None:
            return f"Tag {tag_tuple}: Not present in dataset"
        
        info = []
        info.append(f"Tag {tag_tuple} ({elem.tag}):")
        info.append(f"  Keyword: {elem.keyword}")
        info.append(f"  VR: {elem.VR}")
        info.append(f"  VM: {elem.VM}")
        info.append(f"  is_empty: {elem.is_empty}")
        info.append(f"  is_undefined_length: {elem.is_undefined_length}")
        
        # Check different ways to access the value
        info.append(f"  Has 'value' attr: {hasattr(elem, 'value')}")
        info.append(f"  Has 'Value' attr: {hasattr(elem, 'Value')}")
        
        # Try to get the value different ways
        try:
            # Direct attribute access
            if hasattr(elem, 'value'):
                info.append(f"  elem.value: {elem.value}")
            else:
                info.append(f"  elem.value: <no attribute>")
        except Exception as e:
            info.append(f"  elem.value: Error - {e}")
            
        try:
            # Capital V Value
            if hasattr(elem, 'Value'):
                info.append(f"  elem.Value: {elem.Value}")
            else:
                info.append(f"  elem.Value: <no attribute>")
        except Exception as e:
            info.append(f"  elem.Value: Error - {e}")
            
        try:
            # Using DataElement as callable
            val = elem()
            info.append(f"  elem(): {val}")
        except Exception as e:
            info.append(f"  elem(): Error - {e}")
            
        try:
            # String representation
            info.append(f"  str(elem): {str(elem)}")
        except Exception as e:
            info.append(f"  str(elem): Error - {e}")
            
        return "\n".join(info)
        
    except Exception as e:
        return f"Error inspecting tag {tag_tuple}: {e}"

def main(file_path):
    """Inspect problematic tags in detail."""
    try:
        ds = pydicom.dcmread(file_path)
        print(f"=== Detailed DICOM Tag Inspection: {Path(file_path).name} ===\n")
        
        # Tags that were reported as having no Value attribute
        problematic_tags = [
            (0x0008, 0x0018),  # SOP Instance UID
            (0x0010, 0x0010),  # Patient Name
            (0x0010, 0x0020),  # Patient ID  
            (0x0020, 0x000D),  # Study Instance UID
            (0x0020, 0x000E),  # Series Instance UID
        ]
        
        print("Inspecting tags that were reported as having no Value attribute:\n")
        for tag in problematic_tags:
            print(inspect_tag_details(ds, tag))
            print()
            
        # Also check how the anonymizer might be accessing these
        print("\nTesting access patterns that might be used by the anonymizer:")
        
        # Test direct access to Patient Name
        try:
            patient_name = ds.PatientName
            print(f"ds.PatientName: {patient_name}")
            print(f"  Type: {type(patient_name)}")
            print(f"  Has Value attr: {hasattr(patient_name, 'Value')}")
            if hasattr(patient_name, 'value'):
                print(f"  patient_name.value: {patient_name.value}")
        except Exception as e:
            print(f"ds.PatientName: Error - {e}")
            
    except Exception as e:
        print(f"Error reading DICOM file: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python inspect_dicom_detailed.py <dicom_file>")
        sys.exit(1)
        
    main(sys.argv[1])