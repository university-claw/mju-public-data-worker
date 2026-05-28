import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectCourseCatalog,
  exportCourseCatalogFromMjuCliDepartmentTimetable,
  exportCourseCatalogsFromMjuCliDepartmentTimetables,
} from "../../src/workers/course-catalog-collector.js";

const tempFiles: string[] = [];

afterEach(async () => {
  await Promise.all(tempFiles.splice(0).map((file) => fs.rm(file, { force: true })));
});

describe("course catalog collector", () => {
  it("redacts MSI credentials when the underlying CLI command fails", async () => {
    const userId = "TEST-99212256";
    const password = "secret-password";

    await expect(
      exportCourseCatalogFromMjuCliDepartmentTimetable({
        command: "mju",
        appDir: "C:\\tmp\\mju-sso-collect",
        userId,
        password,
        year: 2026,
        termCode: "10",
        termLabel: "1학기",
        departmentCode: "15611",
        runner: async () => {
          throw new Error(
            `Command failed: mju auth login --id ${userId} --password ${password}`,
          );
        },
      }),
    ).rejects.toThrow(
      "mju CLI command failed: Command failed: mju auth login --id [redacted] --password [redacted]",
    );
  });

  it("retries transient MSI network resets without leaking credentials", async () => {
    const userId = "TEST-99212256";
    const password = "secret-password";
    let departmentAttempts = 0;

    const snapshot = await exportCourseCatalogFromMjuCliDepartmentTimetable({
      command: "mju",
      appDir: "C:\\tmp\\mju-sso-collect",
      userId,
      password,
      year: 2026,
      termCode: "10",
      termLabel: "1학기",
      departmentCode: "15611",
      runner: async (_file, args) => {
        if (args.includes("auth")) {
          return { stdout: "{}", stderr: "" };
        }
        departmentAttempts += 1;
        if (departmentAttempts < 3) {
          throw new Error(`read ECONNRESET --id ${userId} --password ${password}`);
        }
        return {
          stdout: JSON.stringify({
            year: 2026,
            termCode: "10",
            termLabel: "1학기",
            campusDiv: "",
            campusLabel: "전체",
            departmentCode: "15611",
            departmentLabel: "15611 컴퓨터정보통신공학부 컴퓨터공학전공",
            resultCount: 1,
            entries: [
              {
                gradeLevel: "3학년",
                courseTitle: "기계학습",
                credit: 3,
                professor: "현상원",
                section: "0727",
                curiNum: "JEJ01472",
                meetings: [
                  {
                    dayOfWeek: 1,
                    dayLabel: "월",
                    timeRange: "13:00~14:50",
                    startTime: "13:00",
                    endTime: "14:50",
                    location: "Y5445",
                  },
                ],
              },
            ],
          }),
          stderr: "",
        };
      },
    });

    expect(departmentAttempts).toBe(3);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.courseTitle).toBe("기계학습");
  });

  it("exports multiple department timetable snapshots with de-duplicated department codes", async () => {
    const departmentCodes: string[] = [];
    let authAttempts = 0;

    const snapshots = await exportCourseCatalogsFromMjuCliDepartmentTimetables({
      command: "mju",
      appDir: "C:\\tmp\\mju-sso-collect",
      userId: "TEST-99212256",
      password: "secret-password",
      year: 2026,
      termCode: "10",
      termLabel: "1학기",
      departmentCodes: ["15611", "10000", "15611", " "],
      runner: async (_file, args) => {
        if (args.includes("auth")) {
          authAttempts += 1;
          return { stdout: "{}", stderr: "" };
        }

        const departmentCode = args[args.indexOf("--dept-code") + 1] ?? "";
        departmentCodes.push(departmentCode);
        const isLiberal = departmentCode === "10000";

        return {
          stdout: JSON.stringify({
            year: 2026,
            termCode: "10",
            termLabel: "1학기",
            campusDiv: "",
            campusLabel: "전체",
            departmentCode,
            departmentLabel: isLiberal
              ? "10000 자연캠퍼스 교양"
              : "15611 컴퓨터정보통신공학부 컴퓨터공학전공",
            resultCount: 1,
            entries: [
              {
                gradeLevel: isLiberal ? "전학년" : "3학년",
                courseTitle: isLiberal ? "성서와인간이해" : "기계학습",
                credit: isLiberal ? 2 : 3,
                professor: isLiberal ? "김진옥" : "현상원",
                section: isLiberal ? "0001" : "0727",
                curiNum: isLiberal ? "KMA00101" : "JEJ01472",
                meetings: [
                  {
                    dayOfWeek: 1,
                    dayLabel: "월",
                    timeRange: "09:00~10:50",
                    startTime: "09:00",
                    endTime: "10:50",
                    location: "Y2529",
                  },
                ],
              },
            ],
          }),
          stderr: "",
        };
      },
    });

    expect(departmentCodes).toEqual(["15611", "10000"]);
    expect(authAttempts).toBe(1);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]?.metadata.departmentLabel).toBe(
      "15611 컴퓨터정보통신공학부 컴퓨터공학전공",
    );
    expect(snapshots[0]?.entries[0]?.department).toBe(
      "15611 컴퓨터정보통신공학부 컴퓨터공학전공",
    );
    expect(snapshots[1]?.entries[0]).toMatchObject({
      category: "elective",
      categoryLabel: "공통교양",
      courseTitle: "성서와인간이해",
    });
  });

  it("expands all department codes from MSI department options", async () => {
    const requestedDepartmentCodes: string[] = [];
    let authAttempts = 0;

    const snapshots = await exportCourseCatalogsFromMjuCliDepartmentTimetables({
      command: "mju",
      appDir: "C:\\tmp\\mju-sso-collect",
      userId: "TEST-99212256",
      password: "secret-password",
      year: 2026,
      termCode: "10",
      termLabel: "1학기",
      departmentCodes: ["all"],
      seedDepartmentCode: "10000",
      runner: async (_file, args) => {
        if (args.includes("auth")) {
          authAttempts += 1;
          return { stdout: "{}", stderr: "" };
        }

        const departmentCode = args[args.indexOf("--dept-code") + 1] ?? "";
        requestedDepartmentCodes.push(departmentCode);
        const isSeed = departmentCode === "10000";

        return {
          stdout: JSON.stringify({
            year: 2026,
            termCode: "10",
            termLabel: "1학기",
            campusDiv: "",
            campusLabel: "전체",
            departmentCode,
            departmentLabel: isSeed
              ? "10000 자연캠퍼스 교양"
              : "15611 컴퓨터정보통신공학부 컴퓨터공학전공",
            departmentOptions: isSeed
              ? [
                  { code: "", label: "전체 선택" },
                  { code: "10000", label: "10000 자연캠퍼스 교양" },
                  { code: "15611", label: "15611 컴퓨터정보통신공학부 컴퓨터공학전공" },
                  { code: "15611", label: "15611 컴퓨터정보통신공학부 컴퓨터공학전공" },
                ]
              : [],
            resultCount: 1,
            entries: [
              {
                gradeLevel: isSeed ? "전학년" : "3학년",
                courseTitle: isSeed ? "성서와인간이해" : "기계학습",
                credit: isSeed ? 2 : 3,
                professor: isSeed ? "김진옥" : "현상원",
                section: isSeed ? "0001" : "0727",
                curiNum: isSeed ? "KMA00101" : "JEJ01472",
                meetings: [
                  {
                    dayOfWeek: 1,
                    dayLabel: "월",
                    timeRange: "09:00~10:50",
                    startTime: "09:00",
                    endTime: "10:50",
                    location: "Y2529",
                  },
                ],
              },
            ],
          }),
          stderr: "",
        };
      },
    });

    expect(requestedDepartmentCodes).toEqual(["10000", "15611"]);
    expect(authAttempts).toBe(1);
    expect(snapshots.map((snapshot) => snapshot.metadata.departmentLabel)).toEqual([
      "10000 자연캠퍼스 교양",
      "15611 컴퓨터정보통신공학부 컴퓨터공학전공",
    ]);
  });

  it("collects every snapshot from a batch export JSON file", async () => {
    const inputPath = path.join(
      os.tmpdir(),
      `mju-course-catalog-batch-${Date.now()}-${Math.random()}.json`,
    );
    tempFiles.push(inputPath);
    await fs.writeFile(
      inputPath,
      JSON.stringify([
        {
          year: 2026,
          termCode: "10",
          termLabel: "1학기",
          sourceKind: "mju_cli_msi_department_timetable",
          metadata: { departmentCode: "15611", departmentLabel: "컴퓨터공학전공" },
          entries: [],
        },
        {
          year: 2026,
          termCode: "10",
          termLabel: "1학기",
          sourceKind: "mju_cli_msi_department_timetable",
          metadata: { departmentCode: "10000", departmentLabel: "자연캠퍼스 교양" },
          entries: [],
        },
      ]),
      "utf8",
    );

    let nextSnapshotId = 10;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("RETURNING id")) {
        nextSnapshotId += 1;
        return { rows: [{ id: nextSnapshotId }] };
      }
      return { rows: [] };
    });
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({ query, release })),
    };

    const result = await collectCourseCatalog(pool as never, "public_data", {
      inputPath,
    });

    expect(result).toEqual([
      { snapshotId: 11, year: 2026, termCode: "10", entryCount: 0 },
      { snapshotId: 12, year: 2026, termCode: "10", entryCount: 0 },
    ]);
    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.filter((call) => String(call[0]).includes("BEGIN"))).toHaveLength(2);
    expect(query.mock.calls.filter((call) => String(call[0]).includes("COMMIT"))).toHaveLength(2);
    expect(query.mock.calls.filter((call) => String(call[0]).includes("INSERT INTO public_data.course_catalog_snapshots"))).toHaveLength(2);
  });
});
