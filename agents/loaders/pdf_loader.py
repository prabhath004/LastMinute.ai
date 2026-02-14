import pdfplumber

from .base_loader import BaseLoader


class PDFLoader(BaseLoader):
    def load(self, path: str) -> str:
        texts = []
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    texts.append(text)
        return "\n".join(texts)
