import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { importGraduationRequirementsDirectory } from "../../src/workers/graduation-requirement-importer.js";

describe("graduation requirement importer", () => {
  it("imports every json seed in a directory in a stable order", async () => {
    const inputDir = await mkdtemp(path.join(process.cwd(), ".tmp-mju-grad-req-"));
    await writeFile(
      path.join(inputDir, "b-computer.json"),
      JSON.stringify({
        department: "컴퓨터공학전공",
        admissionYear: 2024,
        sourceKind: "department_page",
        sourceTitle: "컴퓨터공학전공 졸업이수가이드",
        sourceUrl: "https://cs.mju.ac.kr/cs/10763/subview.do",
        rules: [
          {
            requirementKey: "major-credit",
            label: "전공",
            category: "전공",
            requiredCredits: 70,
            status: "confirmed",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(inputDir, "a-common.json"),
      JSON.stringify({
        department: "전체 학부(과)",
        admissionYear: 2023,
        sourceKind: "department_page",
        sourceTitle: "방목기초교육대학 공통교양",
        sourceUrl: "https://www.mju.ac.kr/bangmok/1649/subview.do",
        rules: [
          {
            requirementKey: "common-liberal-english-2023-plus",
            label: "공통교양 언어(영어)",
            category: "공통교양",
            status: "confirmed",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(path.join(inputDir, "README.txt"), "ignored", "utf8");

    let nextSourceId = 30;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("RETURNING id")) return { rows: [{ id: nextSourceId++ }] };
      return { rows: [] };
    });
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({ query, release })),
    };

    try {
      const result = await importGraduationRequirementsDirectory(pool as never, "public_data", {
        inputDir,
      });

      expect(result.imported).toBe(2);
      expect(result.results.map((item) => item.department)).toEqual([
        "전체 학부(과)",
        "컴퓨터공학전공",
      ]);
      expect(result.results.map((item) => item.sourceId)).toEqual([30, 31]);
      expect(pool.connect).toHaveBeenCalledTimes(2);
      expect(release).toHaveBeenCalledTimes(2);
    } finally {
      await rm(inputDir, { recursive: true, force: true });
    }
  });

  it("reports the failing seed path when a directory import cannot parse a file", async () => {
    const inputDir = await mkdtemp(path.join(process.cwd(), ".tmp-mju-grad-req-"));
    await writeFile(path.join(inputDir, "bad.json"), JSON.stringify({
      department: "컴퓨터공학전공",
      admissionYear: 2025,
      sourceKind: "department_page",
      sourceTitle: "컴퓨터공학전공 교과과정",
      sourceUrl: "https://www.mju.ac.kr/mjukr/808/subview.do",
    }), "utf8");

    const pool = {
      connect: vi.fn(),
    };

    try {
      await expect(importGraduationRequirementsDirectory(pool as never, "public_data", {
        inputDir,
      })).rejects.toThrow(/bad\.json: graduation requirement import JSON must contain rules\[\]/);
      expect(pool.connect).not.toHaveBeenCalled();
    } finally {
      await rm(inputDir, { recursive: true, force: true });
    }
  });
});
