import fs from "fs";
import path from "path";
import { BaseConnector } from "./base.js";
import pino from "pino";

const log = pino({ level: "info" });

export class FileUploadConnector extends BaseConnector {
  /**
   * @param {{ files: Array<{ path: string, originalName: string }> }} cfg
   */
  constructor(cfg) {
    super();
    this.files = cfg.files ?? [];
  }

  async healthCheck() {
    const allExist = this.files.every((f) => fs.existsSync(f.path));
    return allExist
      ? { ok: true, message: "All files accessible" }
      : { ok: false, message: "One or more uploaded files not found" };
  }

  async fetchDocuments() {
    const documents = [];

    for (const file of this.files) {
      try {
        const content = await this.#extractText(file.path, file.originalName);
        if (content?.trim().length > 0) {
          documents.push({
            id: `file-${path.basename(file.path)}`,
            title: file.originalName,
            content,
            url: null,
            sourceType: "file",
            metadata: { originalName: file.originalName },
          });
          log.info({ file: file.originalName }, "Parsed uploaded file");
        }
      } catch (err) {
        log.warn({ file: file.originalName, err: err.message }, "Failed to parse file");
      }
    }

    return documents;
  }

  async #extractText(filePath, originalName) {
    const ext = path.extname(originalName).toLowerCase();

    if (ext === ".pdf") {
      const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      return data.text;
    }

    if (ext === ".docx") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    }

    if (ext === ".xlsx" || ext === ".xls") {
      const XLSX = await import("xlsx");
      const workbook = XLSX.readFile(filePath);
      return workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name];
        return `Sheet: ${name}\n${XLSX.utils.sheet_to_csv(sheet)}`;
      }).join("\n\n");
    }

    if ([".txt", ".md", ".html", ".csv"].includes(ext)) {
      return fs.readFileSync(filePath, "utf-8");
    }

    throw new Error(`Unsupported file type: ${ext}`);
  }
}
