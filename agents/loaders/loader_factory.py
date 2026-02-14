import os

from .image_loader import ImageLoader
from .pdf_loader import PDFLoader
from .ppt_loader import PPTLoader
from .text_loader import TextLoader


def get_loader(path: str):
    extension = os.path.splitext(path)[1].lower()

    if extension == ".pdf":
        return PDFLoader()
    if extension in {".txt", ".md"}:
        return TextLoader()
    if extension == ".pptx":
        return PPTLoader()
    if extension in {".png", ".jpg", ".jpeg"}:
        return ImageLoader()

    raise ValueError(f"Unsupported file type: {extension}")
