# Jira: Recommended Assignee

This project contains a Forge plugin written in Javascript that determines the recommended assignee to unassigned Jira issues.

## Overview
This Forge plugin uses a custom weighted scoring algorithm to match unassigned Jira issues with the most suitable team members. 
The system analyzes multiple factors including labels, components, issue types, historical assignments, worklogs, comments, and current capacity to make data-driven assignment recommendations.

#### Key Features
- Issue Panel UI: View recommendations, assign with one click, or decline
- Admin Control Panel: Bulk assignment operations across epics, labels, and tasks with configurable criteria
- Evidence Transparency: Detailed breakdown showing why each candidate was recommended
- Decline Workflow: Users can opt-out, triggering automatic recalculation
- Performance Optimised: Event-driven caching with Forge KVS for efficient data access

## Project Attribution

This project originated as a collaborative capstone project completed by a team of six members during Term 3 at UNSW.
This repository represents an individually maintained version of that project.

**Original Team Members:** Jake Lai, Humza Ahmad, Benny Situ, Derek Zhang, Joyce Geng, Sreyam Bhakta

**Current Maintainer:** Jake Lai

## Architecture
- Frontend Layer: React components for issue panel and admin interface
- API Layer: Forge resolvers exposing backend functionality
- Business Logic: Scoring engine, data processing, and scraping orchestration
- Data Access: Cache management (Forge KVS) and API wrappers (Jira/Confluence)

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

> **Note:** `src/resolvers/index.js` remains untested as it primarily contains Forge resolver wiring. The underlying business logic invoked by these resolvers is covered in the test suites.

Run the full suite (including coverage) with:

```bash
npm run test:coverage
```

## Support

See [Get help](https://developer.atlassian.com/platform/forge/get-help/) for how to get help and provide feedback.
For project-specific issues, please open an issue in this repository.
