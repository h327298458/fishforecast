import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

type ManifestRecord = {
  filename: string;
  sha256: string;
};

const root = resolve(process.argv[2] ?? "data/raw/tides/bom-nsw");
const manifest = JSON.parse(
  readFileSync(resolve(root, "downloads-manifest.json"), "utf8").replace(/^\uFEFF/, ""),
) as ManifestRecord[];

for (const record of manifest) {
  const binary = readFileSync(resolve(root, record.filename));
  const document = await getDocument({
    data: new Uint8Array(binary),
    verbosity: 0,
  }).promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      );
    }
    const target = resolve(root, `${record.filename}.txt`);
    writeFileSync(target, pages.join(" "), "utf8");
    console.log(`${record.filename} -> ${target}`);
  } finally {
    await document.destroy();
  }
}
