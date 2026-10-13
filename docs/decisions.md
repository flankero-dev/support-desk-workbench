# Engineering decisions

## One queue, three different kinds of state

Requests live in the versioned workspace document. Filters live in the URL. Pagination, selection and the open dialog are temporary interface state. Named views are separate browser preferences.

This separation makes a copied URL reproduce the queue without putting request bodies or notes in the address bar. It also explains why applying a filter resets pagination and selection, while editing a request preserves its notes.

Implementation: [App](../src/App.tsx), [ticket domain](../src/domain/tickets.ts), [saved-view contract](../src/domain/views.ts).

## Pure domain functions, small React state

Filtering, sorting, immutable updates and import validation are ordinary TypeScript functions. Components call them rather than duplicating the rules. The current queue is small enough for React state and a memoized result list; a global state package would add a second abstraction without solving the persistence problem.

A larger shared queue would need server queries, pagination and authorization. The current table renders eight rows per page and permits importing at most 500 requests.

Evidence: [domain tests](../tests/tickets.test.mjs).

## Import is a replacement boundary

The parser starts with unknown JSON, checks the version, required fields, unique IDs, enums, dates and activity entries, then picks known fields. The dialog only replaces the workspace after this succeeds.

Validating TypeScript types alone would not validate a file supplied at runtime. Parsing and validation therefore belong to the domain boundary, not to an input component.

The same contract is used when loading browser storage and handling the local API. Export uses compact JSON. Imports validate both the input and its canonical export size. Every mutation checks serialized UTF-8 size before committing to React state; a change that exceeds 2 MB is rejected, preserving the current requests and a draft note. Persistence retains a defensive validation before writing. This keeps export and restore within the same contract even when browser storage is blocked or a tab is conflicted.

## Multiple tabs do not silently win

A storage event marks a stale tab as conflicted. The save path also compares the stored document with its last saved value immediately before writing. The tab keeps its current in-memory edits and offers an export and reload path.

This detects practical conflicts but does not turn localStorage into a transactional database. Named-view writes have the same limitation.

Evidence: [persistence hook](../src/useWorkspace.ts), [two-tab browser scenarios](../tests/browser-smoke.mjs).

## Native dialogs still need explicit focus handling

`showModal()` provides modal behavior and Escape dismissal. The application restores focus to the opening button. If changing a request removes that button from the active filter, focus returns to search.

Long imported strings need their own layout constraints: the grid uses `minmax(0, 1fr)`, selects fit their columns and text wraps inside the dialog. Hiding page overflow would conceal the problem rather than make the content readable.

## Relational storage keeps snapshots consistent

The optional server stores requests in `tickets`, history in `activities`, and the revision in a singleton `workspace` row. Foreign keys cascade deleted requests to their history. SQL constraints enforce status and priority values, unique request positions and unique history positions within each request. Explicit positions preserve imported order; timestamps need not be unique.

The HTTP contract remains a versioned JSON snapshot. GET reads the revision and related rows in one transaction. PUT uses `If-Match`: a conditional revision update and replacement of all requests and history share a `BEGIN IMMEDIATE` transaction. A stale client receives HTTP 412 without deleting any rows. The successful response is assembled inside that same transaction, so its body and ETag describe the committed write. Any failed insertion rolls the entire replacement back, including the revision.

Schema version 1 migrates the former JSON document once, retaining its revision, request order and history. Validation, table creation, data insertion and removal of the legacy table share one transaction. Invalid legacy data aborts startup and remains available for recovery; it is not overwritten by sample data. Unknown future schema versions also abort startup. Back up an existing database before upgrading: the old server cannot read the new schema.

Full replacement is deliberate: the UI synchronizes a bounded workspace of at most 500 requests, not individual server records. This does not provide query pagination, authentication or a shared-service authorization model. The loopback server remains separate from the static demo.

Evidence: [storage and migration](../server/storage.ts), [HTTP boundary](../server/app.ts), [restart, migration, independent connections and rollback tests](../tests/server-api.test.mjs).

## Regression examples

- Option labels changed by a translator must retain the underlying status/priority values.
- A 200-character assignee must survive URL encoding and named-view reload.
- The assignee `All` must remain distinct from the unfiltered queue.
- An imported history of 500 entries must accept another note and still reload.
- An edit that would cross the size boundary must preserve both in-memory and saved requests, retain the note draft and show a rejection. Exporting the unchanged workspace must still restore successfully.

These cases are covered in the domain and browser suites. Coverage is scoped to the implemented workflows, not a claim that every browser or arbitrary dataset has been certified.

## Dense information still needs readable labels

Status, priority, assignee and sidebar labels use darker colours against their actual backgrounds. Browser checks calculate text contrast for these compact labels. The table is a named, focusable scroll region so keyboard users can reach columns on small screens.

Select all applies to the visible page. Selection is retained when changing pages, while changing filters clears it. A visible hint states the pagination rule and a browser regression checks selecting and deselecting separate pages.

The 2 MB JSON limit is measured in UTF-8 bytes, matching the HTTP boundary. A regression uses a Cyrillic document that fits the former string-length limit but exceeds the byte limit. Small Unicode documents still round-trip normally. An unreadable-storage warning now explains that the displayed data is the sample and that editing or importing replaces the unreadable saved copy; exporting the sample is not presented as recovery of that copy.

## Local API availability

A loopback hostname alone does not imply an API. The header performs one bounded GET probe and enables Server snapshot only for a JSON response with a valid ETag. A Vite HTML fallback keeps it disabled with a setup hint. Non-loopback deployments neither probe nor show the control. The dialog still handles later network failures and revision conflicts.
