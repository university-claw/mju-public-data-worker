import type { CafeteriaResolvedMenuEntryInput } from "./types.js";

export interface CafeteriaResolvedMenuSelectorRepositoryLike {
  listInstagramMenuEntryCandidates(
    sourceId: string,
    startDate: string,
    endDate: string,
  ): Promise<
    Array<{
      entryId: number;
      sourceId: string;
      serviceDate: string;
      mealType: "breakfast" | "lunch" | "dinner";
      isClosed: boolean;
      menuText: string;
      menuItems: string[];
    }>
  >;
  listOfficialMenuEntryCandidates(
    sourceId: string,
    startDate: string,
    endDate: string,
  ): Promise<
    Array<{
      entryId: number;
      sourceId: string;
      serviceDate: string;
      mealType: "breakfast" | "lunch" | "dinner";
      isClosed: boolean;
      menuText: string;
      menuItems: string[];
    }>
  >;
  syncResolvedMenuEntriesForDateRange(params: {
    sourceId: string;
    startDate: string;
    endDate: string;
    entries: CafeteriaResolvedMenuEntryInput[];
  }): Promise<{ upsertedCount: number; deletedCount: number }>;
}

export interface RefreshResolvedMenusForDateRangeParams {
  sourceId: string;
  startDate: string;
  endDate: string;
  selectedAt?: string;
}

export interface RefreshResolvedMenusForDateRangeResult {
  upsertedCount: number;
  deletedCount: number;
}

function buildKey(serviceDate: string, mealType: "breakfast" | "lunch" | "dinner"): string {
  return `${serviceDate}:${mealType}`;
}

export async function refreshResolvedMenusForDateRange(
  repository: CafeteriaResolvedMenuSelectorRepositoryLike,
  params: RefreshResolvedMenusForDateRangeParams,
): Promise<RefreshResolvedMenusForDateRangeResult> {
  const selectedAt = params.selectedAt ?? new Date().toISOString();
  const [instagramCandidates, officialCandidates] =
    await Promise.all([
      repository.listInstagramMenuEntryCandidates(
        params.sourceId,
        params.startDate,
        params.endDate,
      ),
      repository.listOfficialMenuEntryCandidates(
        params.sourceId,
        params.startDate,
        params.endDate,
      ),
    ]);

  const winners = new Map<string, CafeteriaResolvedMenuEntryInput>();

  for (const candidate of officialCandidates) {
    const key = buildKey(candidate.serviceDate, candidate.mealType);
    winners.set(key, {
      sourceId: candidate.sourceId,
      serviceDate: candidate.serviceDate,
      mealType: candidate.mealType,
      selectedSourceKind: "official_page",
      selectedOfficialEntryId: candidate.entryId,
      isClosed: candidate.isClosed,
      menuText: candidate.menuText,
      menuItems: candidate.menuItems,
      selectionReason: "official page row is more authoritative than OCR",
      selectedAt,
    });
  }

  for (const candidate of instagramCandidates) {
    const key = buildKey(candidate.serviceDate, candidate.mealType);
    if (winners.has(key)) {
      continue;
    }

    winners.set(key, {
      sourceId: candidate.sourceId,
      serviceDate: candidate.serviceDate,
      mealType: candidate.mealType,
      selectedSourceKind: "instagram_ocr",
      selectedInstagramEntryId: candidate.entryId,
      isClosed: candidate.isClosed,
      menuText: candidate.menuText,
      menuItems: candidate.menuItems,
      selectionReason: "official page row is unavailable, so OCR result is used",
      selectedAt,
    });
  }

  return repository.syncResolvedMenuEntriesForDateRange({
    sourceId: params.sourceId,
    startDate: params.startDate,
    endDate: params.endDate,
    entries: Array.from(winners.values()),
  });
}
