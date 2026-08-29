# Epic Laundry V2 — Architecture

## Retained foundation

Electron remains the offline desktop shell. The renderer stays unprivileged and
talks to a local Fastify service. SQLite remains the transaction engine. This
preserves the strongest current property: core counter work continues without a
cloud dependency.

## Target boundaries

```text
Electron Main (trusted desktop boundary)
  ├─ workspace selector / protected local configuration
  ├─ authenticated child-process bootstrap and printer/file adapters
  └─ unprivileged React renderer
       └─ typed local API contracts
            └─ Fastify bounded-context routes
                 ├─ orders / garment tracking / production
                 ├─ customers / catalogue / packages / payments
                 ├─ delivery / reports / settings
                 └─ SQLite migrations + constrained relational tables
```

The initial V2 change is workspace selection: the production database and the
demo database must be distinct files, selected only by the desktop main process.
The backend receives the selected mode as an explicit environment value and only
demo mode can seed synthetic records.

## Migration strategy

1. Preserve existing database files and read paths.
2. Add numbered migrations and `schema_migrations` before introducing normalized
   operational/financial tables.
3. Backfill immutable snapshots without deleting generic legacy rows.
4. Route new commands to normalized tables while maintaining compatibility reads.
5. Remove legacy write paths only after migration, reconciliation and rollback
   evidence are complete.

Cloud synchronization, payment providers and hardware remain interfaces until the
required external credentials/protocols are supplied; they are not fabricated.
