#!/usr/bin/env python3
"""
Create a simple test PDF file for the PDF converter plugin.
"""
# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "reportlab>=3.6.0",
# ]
# ///

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.colors import red, green, blue, black
import os

def create_test_pdf():
    """Create a multi-page test PDF with different content on each page."""
    
    # Create the output directory if it doesn't exist
    output_dir = "src/plugins/pdfConverter/test-data"
    os.makedirs(output_dir, exist_ok=True)
    
    # Create the PDF file
    pdf_path = os.path.join(output_dir, "test-document.pdf")
    c = canvas.Canvas(pdf_path, pagesize=letter)
    
    # Page 1 - Text content
    c.drawString(100, 750, "Test PDF Document - Page 1")
    c.drawString(100, 700, "This is a test PDF created for the PDF to DICOM converter plugin.")
    c.drawString(100, 650, "Each page has different content to verify proper conversion.")
    c.setFillColor(red)
    c.drawString(100, 600, "Red text on page 1")
    c.setFillColor(black)
    c.drawString(100, 550, "Patient: Test Patient")
    c.drawString(100, 500, "ID: TEST-001")
    c.drawString(100, 450, "Date: 2024-01-01")
    c.showPage()
    
    # Page 2 - Shapes and graphics
    c.drawString(100, 750, "Test PDF Document - Page 2")
    c.drawString(100, 700, "This page contains shapes and graphics")
    
    # Draw some shapes
    c.setFillColor(blue)
    c.rect(100, 500, 200, 100, fill=1)
    c.setFillColor(green)
    c.circle(400, 550, 50, fill=1)
    c.setFillColor(red)
    # Draw a triangle instead of polygon
    path = c.beginPath()
    path.moveTo(300, 400)
    path.lineTo(350, 450)
    path.lineTo(400, 400)
    path.close()
    c.drawPath(path, fill=1)
    
    c.setFillColor(black)
    c.drawString(100, 300, "Blue rectangle, green circle, red triangle")
    c.showPage()
    
    # Page 3 - Medical-like content
    c.drawString(100, 750, "Test PDF Document - Page 3")
    c.drawString(100, 700, "Medical Report Summary")
    c.drawString(100, 650, "=" * 50)
    c.drawString(100, 600, "Patient: John Doe")
    c.drawString(100, 580, "DOB: 1980-01-01")
    c.drawString(100, 560, "Study Date: 2024-01-15")
    c.drawString(100, 540, "Modality: PDF Conversion Test")
    c.drawString(100, 500, "Findings:")
    c.drawString(120, 480, "- Test page 1 content detected")
    c.drawString(120, 460, "- Test page 2 graphics identified")
    c.drawString(120, 440, "- Page 3 medical format confirmed")
    c.drawString(100, 400, "Impression: PDF to DICOM conversion ready for testing")
    c.showPage()
    
    # Save the PDF
    c.save()
    
    print(f"Test PDF created: {pdf_path}")
    
    # Verify the file was created
    if os.path.exists(pdf_path):
        file_size = os.path.getsize(pdf_path)
        print(f"File size: {file_size} bytes")
        return pdf_path
    else:
        raise Exception("Failed to create PDF file")

if __name__ == "__main__":
    create_test_pdf()