from PIL import Image
import pytesseract

from .base_loader import BaseLoader


class ImageLoader(BaseLoader):
    def load(self, path: str) -> str:
        image = Image.open(path)
        return pytesseract.image_to_string(image)
