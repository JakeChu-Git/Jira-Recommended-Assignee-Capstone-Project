# Jira: Recommended Assignee

This project contains a Forge plugin written in Javascript that determines the recommended assignee to unassigned Jira issues.

## Project Attribution

This project originated as a collaborative capstone project completed by a team of six members during Term 3 at UNSW.

This repository represents an individually maintained version of that project.

**Original Team Members:** Jake Lai, Humza Ahmad, Benny Situ, Derek Zhang, Joyce Geng, Sreyam Bhakta

**Current Maintainer:** Jake Lai

## Requirements

See [Set up Forge](https://developer.atlassian.com/platform/forge/set-up-forge/) for instructions to get set up.

## Quick start

- Register the plugin by running:
```
forge register
```

- Build and deploy the plugin by running:
```
forge deploy
```

- Install the plugin in an Atlassian site by running:
```
forge install
```
## Testing approach & coverage

We rely on Jest with heavy mocking of Forge APIs/KVS so tests can run without a live Atlassian site. Key suites:

- `src/__tests__/autoAssign.test.js` + `autoAssign.integration.test.js`: cover scoring logic and full `recommendAssignee` flows (declines, retries, Jira assignment, comments, state persistence).
- `decline.test.js`: validates assignee checks, comment posting, and notification logic.
- `index.integration.test.js`: exercises `updateAutoAssignSummary`, `autoAssignSummaryValue`, and `setAutoAssignOnCreate`.
- `cache.test.js`, `jiraScraper.test.js`, `confluenceScraper.test.js`, `dataProcessor.test.js`, `scrapeOrchestrator.test.js`: cover caching, Jira/Confluence scraping, data processing, and project orchestration with mocked Forge calls.

Current coverage (`npm run test:coverage`):

| File / Area                   | Stmts | Branch | Funcs | Lines |
| ----------------------------- | ----- | ------ | ----- | ----- |
| `src/cache.js`                | 91.48%| 100%   | 78.94%| 91.48%|
| `src/decline.js`             | 100%  | 100%   | 100%  | 100%  |
| `src/index.js`               | 80.24%| 82.35% | 100%  | 80.24%|
| `src/assignment/autoAssign.js`| 90.32%| 75.70% | 88.88%| 91.56%|
| `src/scrapers/*`             | 62.93%| 51.79% | 79.66%| 63.85%|

> **Note:** `src/resolvers/index.js` remains untested. It primarily wires Forge resolver plumbing to the business logic already covered above, so additional resolver-level tests would give minimal return.

Run the full suite (including coverage) with:

```bash
npm run test:coverage
```

## Support

See [Get help](https://developer.atlassian.com/platform/forge/get-help/) for how to get help and provide feedback.
