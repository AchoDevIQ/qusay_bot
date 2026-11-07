import os
import cv2
import numpy as np
from typing import List
from pydantic import BaseModel

class RegionImage(BaseModel):
    region_id: str
    image_bytes: bytes       # Color, deskewed, optionally rotated
    high_contrast_bytes: bytes # Binarized version for adversarial pass
    orientation: int         # Rotation applied (e.g., 0 or 90)
    region_type: str         # "solution_step" or "sidework"
    bbox: tuple              # (x, y, w, h) in original image

from typing import Optional

def deskew_and_enhance_page(image_bytes: bytes, max_dimension: Optional[int] = None) -> bytes:
    """Deskew, orient, and size the image for optimal vision OCR."""
    if max_dimension is None:
        try:
            max_dimension = int(os.getenv("MAX_IMAGE_DIMENSION", "1200"))
        except (ValueError, TypeError):
            max_dimension = 1200
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return image_bytes
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if contours:
        largest_contour = max(contours, key=cv2.contourArea)
        peri = cv2.arcLength(largest_contour, True)
        approx = cv2.approxPolyDP(largest_contour, 0.02 * peri, True)
        
        if len(approx) == 4 and cv2.contourArea(largest_contour) > 0.6 * img.shape[0] * img.shape[1]:
            pts = approx.reshape(4, 2)
            rect = np.zeros((4, 2), dtype="float32")
            s = pts.sum(axis=1)
            rect[0] = pts[np.argmin(s)]
            rect[2] = pts[np.argmax(s)]
            diff = np.diff(pts, axis=1)
            rect[1] = pts[np.argmin(diff)]
            rect[3] = pts[np.argmax(diff)]
            (tl, tr, br, bl) = rect
            maxWidth = max(int(np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))),
                           int(np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))))
            maxHeight = max(int(np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))),
                            int(np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))))
            dst = np.array([
                [0, 0],
                [maxWidth - 1, 0],
                [maxWidth - 1, maxHeight - 1],
                [0, maxHeight - 1]
            ], dtype="float32")
            M = cv2.getPerspectiveTransform(rect, dst)
            img = cv2.warpPerspective(img, M, (maxWidth, maxHeight))
            
    # Aspect Ratio & Thin Strip Protection
    # If image is thin strip (height < 250px or aspect ratio > 3.0), add white margins
    # to protect horizontal radical bars and prevent distortion in neural vision scaling
    h, w = img.shape[:2]
    if h < 250 or (w / max(h, 1)) > 3.0 or (h / max(w, 1)) > 3.0:
        target_h = max(h + 160, int(w / 2.8)) if (w / max(h, 1)) > 3.0 else max(h, 280)
        pad_vert = max(60, (target_h - h) // 2) if (h < 250 or (w / max(h, 1)) > 3.0) else 40
        target_w = max(w + 120, int(h / 2.8)) if (h / max(w, 1)) > 3.0 else max(w, 400)
        pad_horiz = max(50, (target_w - w) // 2) if ((h / max(w, 1)) > 3.0 or w < 400) else 40
        img = cv2.copyMakeBorder(img, pad_vert, pad_vert, pad_horiz, pad_horiz, cv2.BORDER_CONSTANT, value=[255, 255, 255])

    # Resize if image exceeds MAX_IMAGE_DIMENSION (default 1200px) to optimize vision processing latency & token footprint
    h, w = img.shape[:2]
    max_dim = max(h, w)
    if max_dim > max_dimension:
        scale = float(max_dimension) / max_dim
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        
    _, encoded = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    return encoded.tobytes()

def preprocess_page(image_bytes: bytes) -> List[RegionImage]:
    """
    Preprocess the raw camera image:
    1. Check for blur/exposure issues.
    2. Deskew and crop the paper boundaries.
    3. Detect distinct text regions (steps).
    4. Normalize orientation for sidework (e.g. rotated 90 degrees).
    5. Generate a high-contrast version for each region.
    """
    # Decode image bytes
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if img is None:
        raise ValueError("Invalid image bytes. Could not decode.")
        
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # --- 5. Pre-flight quality gate ---
    laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    if laplacian_var < 10:
        print(f"Warning: image might be too blurry (variance: {laplacian_var})")
        
    mean_brightness = np.mean(gray)
    if mean_brightness < 20 or mean_brightness > 250:
        print(f"Warning: image might be too dark or washed out (mean: {mean_brightness})")
        
    # --- 1. Deskew and crop ---
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if contours:
        largest_contour = max(contours, key=cv2.contourArea)
        peri = cv2.arcLength(largest_contour, True)
        approx = cv2.approxPolyDP(largest_contour, 0.02 * peri, True)
        
        if len(approx) == 4 and cv2.contourArea(largest_contour) > 0.1 * img.shape[0] * img.shape[1]:
            pts = approx.reshape(4, 2)
            rect = np.zeros((4, 2), dtype="float32")
            
            s = pts.sum(axis=1)
            rect[0] = pts[np.argmin(s)]
            rect[2] = pts[np.argmax(s)]
            
            diff = np.diff(pts, axis=1)
            rect[1] = pts[np.argmin(diff)]
            rect[3] = pts[np.argmax(diff)]
            
            (tl, tr, br, bl) = rect
            widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
            widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
            maxWidth = max(int(widthA), int(widthB))
            
            heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
            heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
            maxHeight = max(int(heightA), int(heightB))
            
            dst = np.array([
                [0, 0],
                [maxWidth - 1, 0],
                [maxWidth - 1, maxHeight - 1],
                [0, maxHeight - 1]], dtype="float32")
            
            M = cv2.getPerspectiveTransform(rect, dst)
            img = cv2.warpPerspective(img, M, (maxWidth, maxHeight))
            
    # Re-evaluate gray after potential warp
    deskewed_gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            
    # --- 2. Region/step detection before OCR ---
    # Adaptive thresholding to extract text structure
    binary = cv2.adaptiveThreshold(
        deskewed_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 21, 10
    )
    
    # Dynamic dilation kernel based on image width to properly merge lines
    kw = max(40, int(img.shape[1] * 0.04))
    kh = max(10, int(img.shape[0] * 0.01))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kw, kh))
    dilated = cv2.dilate(binary, kernel, iterations=1)
    
    region_contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # Filter noise contours (must be at least 2% of image width and 1% of height)
    min_w = max(15, int(img.shape[1] * 0.02))
    min_h = max(10, int(img.shape[0] * 0.01))
    regions = []
    for c in region_contours:
        x, y, w, h = cv2.boundingRect(c)
        if w > min_w and h > min_h:
            regions.append((x, y, w, h))
            
    # Cap maximum regions to 15 to avoid contour explosion
    if len(regions) > 15:
        regions = sorted(sorted(regions, key=lambda r: r[2] * r[3], reverse=True)[:15], key=lambda r: r[1])
            
    if not regions:
        # Fallback: Treat the entire image as one region
        regions = [(0, 0, img.shape[1], img.shape[0])]
            
    # Sort top-to-bottom
    regions.sort(key=lambda r: r[1])
    
    results = []
    for i, (x, y, w, h) in enumerate(regions):
        roi = img[y:y+h, x:x+w]
        roi_gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        
        # --- 3. Orientation normalization for sidework ---
        edges_roi = cv2.Canny(roi_gray, 50, 150)
        lines = cv2.HoughLines(edges_roi, 1, np.pi/180, 50)
        
        region_type = "solution_step"
        orientation = 0
        if lines is not None:
            angles = [line[0][1] for line in lines]
            median_theta = np.median(angles)
            angle_deg = median_theta * 180 / np.pi
            
            # If dominant lines are vertical instead of horizontal
            if angle_deg < 45 or angle_deg > 135:
                orientation = 90
                region_type = "sidework"
                roi = cv2.rotate(roi, cv2.ROTATE_90_CLOCKWISE)
                roi_gray = cv2.rotate(roi_gray, cv2.ROTATE_90_CLOCKWISE)
                
        # --- 4. Adaptive contrast/binarization ---
        roi_bin = cv2.adaptiveThreshold(
            roi_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 10
        )
        
        _, color_encoded = cv2.imencode('.png', roi)
        _, bin_encoded = cv2.imencode('.png', roi_bin)
        
        results.append(RegionImage(
            region_id=f"r_{i+1:02d}",
            image_bytes=color_encoded.tobytes(),
            high_contrast_bytes=bin_encoded.tobytes(),
            orientation=orientation,
            region_type=region_type,
            bbox=(x, y, w, h)
        ))
        
    return results
