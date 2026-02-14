import json
import os

from agents.loaders.loader_factory import get_loader


def ingest_directory(directory: str):
    results = {}

    for entry in os.listdir(directory):
        path = os.path.join(directory, entry)
        if not os.path.isfile(path):
            print(f"Skipping non-file: {entry}")
            continue

        try:
            loader = get_loader(path)
            text = loader.load(path)
            results[entry] = {
                "chars": len(text),
                "preview": text[:200],
            }
            print(f"Loaded: {entry}")
        except ValueError:
            print(f"Skipping unsupported file: {entry}")
        except Exception as error:
            print(f"Failed to process {entry}: {error}")

    with open("ingest_output.json", "w", encoding="utf-8") as file:
        json.dump(results, file, indent=2, ensure_ascii=False)

    print("Wrote ingest_output.json")


if __name__ == "__main__":
    ingest_directory("./docs")
