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

The same contract is used when loading browser storage and handling the local API. Export uses compact JSON. Persistence checks the serialized copy before writing so growth cannot overwrite the last saved copy with a document the loader rejects.

## Multiple tabs do not silently win

A storage event marks a stale tab as conflicted. The save path also compares the stored document with its last saved value immediately before writing. The tab keeps its current in-memory edits and offers an export and reload path.

This detects practical conflicts but does not turn localStorage into a transactional database. Named-view writes have the same limitation.

Evidence: [persistence hook](../src/useWorkspace.ts), [two-tab browser scenarios](../tests/browser-smoke.mjs).

## Native dialogs still need explicit focus handling

`showModal()` provides modal behavior and Escape dismissal. The application restores focus to the opening button. If changing a request removes that button from the active filter, focus returns to search.

Long imported strings need their own layout constraints: the grid uses `minmax(0, 1fr)`, selects fit their columns and text wraps inside the dialog. Hiding page overflow would conceal the problem rather than make the content readable.

## Local SQLite snapshots demonstrate concurrency

The optional server stores one workspace and revision. GET returns an ETag. PUT requires the revision through `If-Match`, and a conditional SQL UPDATE increments it only when the expected revision still matches. A stale client receives HTTP 412.

This is a real persistence boundary tested with HTTP requests and temporary SQLite files, including restarting the server and two writes against one revision. The loopback server remains separate from the static demo and has no shared-service authentication model.

Evidence: [server](../server/app.ts), [API tests](../tests/server-api.test.mjs).

## Regression examples

- Option labels changed by a translator must retain the underlying status/priority values.
- A 200-character assignee must survive URL encoding and named-view reload.
- The assignee `All` must remain distinct from the unfiltered queue.
- An imported history of 500 entries must accept another note and still reload.
- A save that crosses the size boundary must preserve the previous saved bytes and show a warning.

These cases are covered in the domain and browser suites. Coverage is scoped to the implemented workflows, not a claim that every browser or arbitrary dataset has been certified.
