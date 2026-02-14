from .base_loader import BaseLoader


class TextLoader(BaseLoader):
    def load(self, path: str) -> str:
        with open(path, "r", encoding="utf-8") as file:
            return file.read()
