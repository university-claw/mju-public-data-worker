import { describe, expect, it, vi } from "vitest";
import {
  refreshResolvedMenusForDateRange,
  type CafeteriaResolvedMenuSelectorRepositoryLike,
} from "../../src/cafeterias/resolved-menu-selector.js";

function createRepositoryMock(
  overrides: Partial<CafeteriaResolvedMenuSelectorRepositoryLike> = {},
): CafeteriaResolvedMenuSelectorRepositoryLike & {
  listInstagramMenuEntryCandidates: ReturnType<typeof vi.fn>;
  listOfficialMenuEntryCandidates: ReturnType<typeof vi.fn>;
  syncResolvedMenuEntriesForDateRange: ReturnType<typeof vi.fn>;
} {
  return {
    listInstagramMenuEntryCandidates: vi.fn(async () => []),
    listOfficialMenuEntryCandidates: vi.fn(async () => []),
    syncResolvedMenuEntriesForDateRange: vi.fn(async ({ entries }) => ({
      upsertedCount: entries.length,
      deletedCount: 0,
    })),
    ...overrides,
  };
}

describe("resolved-menu-selector", () => {
  it("prefers official page candidates over instagram OCR for the same key", async () => {
    const repository = createRepositoryMock({
      listInstagramMenuEntryCandidates: vi.fn(async () => [
        {
          entryId: 11,
          sourceId: "student-hall",
          serviceDate: "2026-04-20",
          mealType: "lunch",
          isClosed: false,
          menuText: "OCR 점심",
          menuItems: ["OCR 점심"],
        },
      ]),
      listOfficialMenuEntryCandidates: vi.fn(async () => [
        {
          entryId: 21,
          sourceId: "student-hall",
          serviceDate: "2026-04-20",
          mealType: "lunch",
          isClosed: false,
          menuText: "[중식 - 덮밥] 공식 점심",
          menuItems: ["[중식 - 덮밥] 공식 점심"],
        },
      ]),
    });

    const result = await refreshResolvedMenusForDateRange(repository, {
      sourceId: "student-hall",
      startDate: "2026-04-20",
      endDate: "2026-04-20",
      selectedAt: "2026-04-21T00:00:00.000Z",
    });

    expect(result).toEqual({
      upsertedCount: 1,
      deletedCount: 0,
    });
    expect(repository.syncResolvedMenuEntriesForDateRange).toHaveBeenCalledWith({
      sourceId: "student-hall",
      startDate: "2026-04-20",
      endDate: "2026-04-20",
      entries: [
        {
          sourceId: "student-hall",
          serviceDate: "2026-04-20",
          mealType: "lunch",
          selectedSourceKind: "official_page",
          selectedOfficialEntryId: 21,
          isClosed: false,
          menuText: "[중식 - 덮밥] 공식 점심",
          menuItems: ["[중식 - 덮밥] 공식 점심"],
          selectionReason: "official page row is more authoritative than OCR",
          selectedAt: "2026-04-21T00:00:00.000Z",
        },
      ],
    });
  });

  it("falls back to instagram OCR when no official candidate exists", async () => {
    const repository = createRepositoryMock({
      listInstagramMenuEntryCandidates: vi.fn(async () => [
        {
          entryId: 31,
          sourceId: "bokji",
          serviceDate: "2026-04-22",
          mealType: "dinner",
          isClosed: false,
          menuText: "OCR 저녁",
          menuItems: ["OCR 저녁"],
        },
      ]),
    });

    await refreshResolvedMenusForDateRange(repository, {
      sourceId: "bokji",
      startDate: "2026-04-22",
      endDate: "2026-04-22",
      selectedAt: "2026-04-21T00:00:00.000Z",
    });

    expect(repository.syncResolvedMenuEntriesForDateRange).toHaveBeenCalledWith({
      sourceId: "bokji",
      startDate: "2026-04-22",
      endDate: "2026-04-22",
      entries: [
        {
          sourceId: "bokji",
          serviceDate: "2026-04-22",
          mealType: "dinner",
          selectedSourceKind: "instagram_ocr",
          selectedInstagramEntryId: 31,
          isClosed: false,
          menuText: "OCR 저녁",
          menuItems: ["OCR 저녁"],
          selectionReason: "official page row is unavailable, so OCR result is used",
          selectedAt: "2026-04-21T00:00:00.000Z",
        },
      ],
    });
  });

  it("passes an empty winner set so the repository can clear stale resolved rows atomically", async () => {
    const repository = createRepositoryMock({
      syncResolvedMenuEntriesForDateRange: vi.fn(async () => ({
        upsertedCount: 0,
        deletedCount: 1,
      })),
    });

    const result = await refreshResolvedMenusForDateRange(repository, {
      sourceId: "myeongjin",
      startDate: "2026-04-23",
      endDate: "2026-04-23",
      selectedAt: "2026-04-21T00:00:00.000Z",
    });

    expect(result).toEqual({
      upsertedCount: 0,
      deletedCount: 1,
    });
    expect(repository.syncResolvedMenuEntriesForDateRange).toHaveBeenCalledWith({
      sourceId: "myeongjin",
      startDate: "2026-04-23",
      endDate: "2026-04-23",
      entries: [],
    });
  });
});
