# Public Data Seed 2026-10

Initial DB seed snapshot for the 2026 year, term code `10` course catalog and
graduation roadmap requirements.

Contents:

- `course-catalog-2026-10.json`: MSI department timetable snapshots for common
  courses and 118 department codes.
- `graduation-requirements/*.json`: official-source graduation requirement
  records prepared for DB import.

Import after migrations:

```bash
npm run collect:course-catalog -- --input data/seeds/public-data/2026-10/course-catalog-2026-10.json
npm run collect:graduation-requirements -- --input-dir data/seeds/public-data/2026-10/graduation-requirements
```

This directory is an initial seed artifact. Runtime readers should use Postgres,
not this JSON directory, after import.
