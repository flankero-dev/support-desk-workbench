# Portfolio audit — 18 October 2026

Scope: S01–S21 for Support Desk; M01–M22 for Merchant. Source, unit and production-build browser checks are being independently verified on the audit branch. No merge or production release is authorized.

Run Node 24, `npm ci`, `npm test`, `npm run format:check`, `npm run lint`, `npm run build`, `npx playwright install --with-deps chromium firefox webkit`, `npm run test:browser`, `npm run test:audit`, `npm run test:a11y`. Set `AUDIT_BROWSER=firefox` or `webkit` for other engines. CI covers Windows and Linux. Detailed evidence and limitations will be attached to the draft PR before acceptance.
