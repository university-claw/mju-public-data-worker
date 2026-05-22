import { describe, expect, it, vi } from "vitest";
import { ShuttleRepository } from "../../src/db/shuttle-repository.js";

describe("shuttle repository", () => {
  function createConnectedPoolMock() {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 77 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const connect = vi.fn(async () => ({
      query,
      release,
    }));

    return {
      pool: {
        connect,
      } as unknown as ConstructorParameters<typeof ShuttleRepository>[0],
      query,
      connect,
      release,
    };
  }

  it("replaces the active timetable and inserts normalized departures", async () => {
    const { pool, query, release } = createConnectedPoolMock();
    const repository = new ShuttleRepository(pool, "public_data");

    const result = await repository.replaceActiveTimetable({
      sourceId: "general",
      sourceExternalId: "12345",
      sourceTitle: "2026학년도 1학기 셔틀버스 운행 안내",
      sourceUrl: "https://www.mju.ac.kr/bbs/mjukr/141/12345/artclView.do",
      sourcePublishedAt: "2026-03-04T00:00:00.000Z",
      academicYear: 2026,
      termLabel: "1학기",
      normalizedAt: "2026-05-01T00:00:00.000Z",
      departures: [
        {
          campus: "자연",
          routeName: "명지대역 노선",
          direction: "명지대역 -> 자연캠퍼스",
          stopName: "명지대역",
          dayType: "weekday",
          departureTime: "18:10",
          note: null,
          sortOrder: 0,
        },
      ],
    });

    expect(result).toEqual({
      timetableVersionId: 77,
      departureCount: 1,
    });
    expect(String(query.mock.calls[0]![0])).toContain("BEGIN");
    expect(String(query.mock.calls[1]![0])).toContain("SET is_active = false");
    expect(String(query.mock.calls[2]![0])).toContain(
      "INSERT INTO public_data.shuttle_timetable_versions",
    );
    expect(String(query.mock.calls[4]![0])).toContain(
      "INSERT INTO public_data.shuttle_departures",
    );
    expect(String(query.mock.calls[5]![0])).toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
