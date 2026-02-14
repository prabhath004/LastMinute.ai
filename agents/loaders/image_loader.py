from .base_loader import BaseLoader

# Lazy import so the app still works for PDF/TXT/MD/PPTX when Pillow isn't installed.
# Image uploads will then fail with a clear message instead of crashing on import.


class ImageLoader(BaseLoader):
    def load(self, path: str) -> str:
        try:
            from PIL import Image
        except ImportError:
            raise ImportError(
                "Image support requires Pillow. Install with: pip install Pillow"
            ) from None
        try:
            import pytesseract
        except ImportError:
            raise ImportError(
                "OCR for images requires pytesseract. Install with: pip install pytesseract"
            ) from None
        image = Image.open(path)
        return pytesseract.image_to_string(image)
