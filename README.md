# Support Desk Workbench

A support queue for triaging requests, recording internal notes and keeping work between visits. Built with React, TypeScript and Vite; an optional local Node.js server adds SQLite snapshots.

[Live demo](https://flankero-dev.github.io/support-desk-workbench/) · [Checks](https://github.com/flankero-dev/support-desk-workbench/actions/workflows/checks.yml) · [Engineering decisions](docs/decisions.md)

The demo uses fictional customers and browser storage. It opens directly into a working queue.

![Request queue with filters, saved views and pagination](docs/workspace.png)

## Review it in two minutes

1. Search for **Maya** and open the checkout request. Change its status, add a note, then close it with **Escape**.
2. Reload. The URL restores the search; the edited request and note remain saved.
3. Clear the search, select **Open** and **Urgent**, name the filters and choose **Save view**. Clear the filters and reapply that view.
4. Select a few visible requests and apply a new status. The selection count and queue update together.
5. Export a backup, reset the sample data, then import the backup to restore the edited workspace.

On a narrow screen the table scrolls within the queue; controls and dialogs stay within the page. The sidebar changes status while preserving other filters.

## Code worth reviewing

| Decision | Implementation | Evidence |
|---|---|---|
| Keep filtering and updates independent of React | [Ticket domain](src/domain/tickets.ts) | [Composed filters, URL round trips, immutable updates and import validation](tests/tickets.test.mjs) |
| Preserve the complete view in a bookmark | [Queue state](src/App.tsx), [saved views](src/domain/views.ts) | [Duplicate views and validation](tests/views.test.mjs) |
| Protect stored edits when another tab writes | [Workspace persistence](src/useWorkspace.ts) | [Two-tab conflict and blocked-storage scenarios](tests/browser-smoke.mjs) |
| Validate a replacement before applying it | [Import dialog](src/components/ImportDialog.tsx) | Invalid JSON leaves the current workspace intact |
| Provide a real optional HTTP/SQL boundary | [Loopback server](server/app.ts) | [Restart persistence and concurrent revision updates](tests/server-api.test.mjs) |
| Preserve keyboard navigation after editing | [Ticket dialog](src/components/TicketDialog.tsx), [queue state](src/App.tsx) | Escape, focus restoration and filtered-out requests in browser smoke |

The regression suite includes long imported names, an assignee literally named `All`, histories exceeding 500 entries and a save that crosses the JSON size limit. These are examples of data-contract and interaction failures found during browser review.

## Run locally

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

To run the built application with the optional SQLite snapshot API:

```sh
npm run build
npm run start
# http://127.0.0.1:3000
```

Choose **Server snapshot → Refresh server copy** to compare the current server revision. Saving uses an ETag and `If-Match`; a stale revision returns HTTP 412. Replacing either copy is an explicit action. The database is `data/workspace.sqlite`, excluded from git.

## Verify

```sh
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:browser
```

Tests use Node's built-in runner. Browser checks use the production build and cover filtering, pagination, saved views, editing, import/export, reset, keyboard focus, storage conflicts and server snapshots. CI runs these checks; the Pages deployment also checks the build before publishing. Browser screenshots are available as CI artifacts.

## Boundaries

- The public demo stores requests in this browser and profile. Export before clearing site data or switching browsers.
- Imports replace the queue after validation. Limits: 500 requests and 2 million JSON characters. Up to eight saved views are separate browser preferences.
- Storage conflicts pause saving in the stale tab. Export its unsaved edits if needed, then reload the saved workspace; changes are not merged automatically.
- The SQLite server binds to loopback and has one workspace. It is a local reference implementation, without user accounts or multi-tenant authorization.
- Activity is editable local history. This project does not claim a production support integration or a certified accessibility audit.
