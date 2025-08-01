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

def test_anonymization_compatibility(file_path):
    """Test if DICOM file structure is compatible with JS anonymization."""
    try:
        ds = pydicom.dcmread(file_path)
        print(f"Testing anonymization compatibility for: {Path(file_path).name}\n")
        
        # Check for common issues
        issues = []
        
        # 1. Check for missing required tags
        required_tags = [
            (0x0008, 0x0018),  # SOP Instance UID
            (0x0010, 0x0010),  # Patient Name
            (0x0010, 0x0020),  # Patient ID
            (0x0020, 0x000D),  # Study Instance UID
            (0x0020, 0x000E),  # Series Instance UID
        ]
        
        for tag in required_tags:
            elem = ds.get(tag)
            if elem is None:
                issues.append(f"Missing required tag {tag}")
            elif elem.is_empty:
                issues.append(f"Empty required tag {tag} ({elem.keyword})")
                
        # 2. Check for problematic VRs
        problematic_vrs = []
        for elem in ds:
            if elem.VR in ['OB', 'OW', 'OF', 'OD', 'OL', 'OV', 'UN'] and elem.tag.group != 0x7FE0:
                problematic_vrs.append(f"{elem.tag} ({elem.keyword}) has VR={elem.VR}")
                
        if problematic_vrs:
            issues.append("Found binary/unknown VRs that might cause issues:")
            issues.extend(f"  - {vr}" for vr in problematic_vrs[:5])
            if len(problematic_vrs) > 5:
                issues.append(f"  ... and {len(problematic_vrs)-5} more")
                
        # 3. Check for sequences with missing items
        for elem in ds:
            if elem.VR == "SQ":
                try:
                    if hasattr(elem.value, '__len__'):
                        for i, item in enumerate(elem.value):
                            if item is None:
                                issues.append(f"Sequence {elem.tag} ({elem.keyword}) has None item at index {i}")
                except:
                    issues.append(f"Cannot iterate sequence {elem.tag} ({elem.keyword})")
                    
        # 4. Check private tags
        private_count = len([elem for elem in ds if elem.tag.group & 0x0001])
        if private_count > 50:
            issues.append(f"High number of private tags ({private_count}) might cause processing issues")
            
        # 5. Check for non-standard character encodings
        char_set = ds.get(0x00080005)  # Specific Character Set
        if char_set and char_set.value not in ['ISO_IR 100', 'ISO_IR 192', '', 'ISO_IR 6']:
            issues.append(f"Non-standard character set: {char_set.value}")
            
        # Report results
        if issues:
            print("⚠️  Potential anonymization issues found:")
            for issue in issues:
                print(f"   - {issue}")
        else:
            print("✅ No obvious compatibility issues found")
            
        # Print summary
        print(f"\nFile summary:")
        print(f"  Total elements: {len(ds)}")
        print(f"  Private tags: {private_count}")
        print(f"  Transfer Syntax: {getattr(ds.file_meta, 'TransferSyntaxUID', 'Unknown')}")
        
        # Try to create a minimal test case
        print("\nCreating minimal test DICOM...")
        test_ds = pydicom.Dataset()
        test_ds.file_meta = pydicom.Dataset()
        test_ds.file_meta.TransferSyntaxUID = pydicom.uid.ExplicitVRLittleEndian
        test_ds.file_meta.MediaStorageSOPClassUID = ds.SOPClassUID
        test_ds.file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
        
        # Copy only essential tags
        essential_tags = [
            'PatientName', 'PatientID', 'StudyInstanceUID', 
            'SeriesInstanceUID', 'SOPInstanceUID', 'SOPClassUID',
            'Modality', 'StudyDate', 'SeriesDate'
        ]
        
        for tag_name in essential_tags:
            if hasattr(ds, tag_name):
                setattr(test_ds, tag_name, getattr(ds, tag_name))
                
        # Save minimal test file
        test_path = Path(file_path).parent / f"minimal_test_{Path(file_path).name}"
        test_ds.save_as(test_path, write_like_original=False)
        print(f"✅ Created minimal test file: {test_path}")
        print("   Try anonymizing this file first to isolate the issue")
        
    except Exception as e:
        print(f"Error analyzing DICOM file: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python test_anonymization.py <dicom_file>")
        sys.exit(1)
        
    test_anonymization_compatibility(sys.argv[1])