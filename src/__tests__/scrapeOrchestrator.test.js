jest.mock('@forge/api', () => {
  const mockRequestJira = jest.fn();
  const asApp = jest.fn(() => ({ requestJira: mockRequestJira }));
  const route = (strings, ...values) =>
    strings.reduce((acc, str, idx) => acc + str + (values[idx] ?? ''), '');
  return {
    __esModule: true,
    default: { asApp },
    asApp,
    route,
    __mockRequestJira: mockRequestJira
  };
});

jest.mock('../scrapers/jiraScraper.js', () => ({
  scrapeAssignableUsers: jest.fn(),
  scrapeProjectEpics: jest.fn(),
  scrapeProjectIssues: jest.fn(),
  scrapeIssueDetails: jest.fn(),
  scrapeIssueWorklogs: jest.fn(),
  scrapeIssueComments: jest.fn(),
  scrapeUserWorkload: jest.fn()
}));

jest.mock('../scrapers/confluenceScraper.js', () => ({
  scrapePagesInSpace: jest.fn(),
  scrapePageDetails: jest.fn(),
  scrapePageContributors: jest.fn(),
  scrapeUserPages: jest.fn()
}));

jest.mock('../scrapers/dataProcessor.js', () => ({
  processIssue: jest.fn(),
  processUserWorkload: jest.fn(),
  processConfluencePage: jest.fn(),
  getScrapingStats: jest.fn()
}));

jest.mock('../cache.js', () => ({
  resetCache: jest.fn(),
  cacheUserProfile: jest.fn(),
  allUserProfiles: jest.fn(),
  allIssues: jest.fn()
}));

import * as orchestrator from '../scrapers/scrapeOrchestrator.js';
import * as jiraScraper from '../scrapers/jiraScraper.js';
import * as dataProcessor from '../scrapers/dataProcessor.js';
import * as cache from '../cache.js';
import { __mockRequestJira } from '@forge/api';

describe('scrapeOrchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jiraScraper.scrapeAssignableUsers.mockResolvedValue([
      { accountId: 'user-1', displayName: 'Alice' },
      { accountId: 'user-2', displayName: 'Bob' }
    ]);
    jiraScraper.scrapeProjectEpics.mockResolvedValue([{ key: 'EPIC-1' }]);
    jiraScraper.scrapeProjectIssues.mockResolvedValue(['PROJ-1']);
    jiraScraper.scrapeIssueDetails.mockResolvedValue({ key: 'PROJ-1', resolutionDate: null });
    jiraScraper.scrapeIssueWorklogs.mockResolvedValue([]);
    jiraScraper.scrapeIssueComments.mockResolvedValue([]);
    jiraScraper.scrapeUserWorkload.mockResolvedValue({ totalIssues: 1 });
    dataProcessor.processIssue.mockResolvedValue();
    dataProcessor.processUserWorkload.mockResolvedValue();
    dataProcessor.getScrapingStats.mockResolvedValue({ totalIssues: 2 });
    cache.allUserProfiles.mockResolvedValue({
      'user-1': { confluencePages: [{ id: 'p1' }] },
      'user-2': {}
    });
    cache.allIssues.mockResolvedValue({
      'PROJ-1': { resolutionDate: null },
      'PROJ-2': { resolutionDate: '2024' }
    });
  });

  test('scrapeFullProject processes users and issues', async () => {
    const stats = await orchestrator.scrapeFullProject('PROJ', { includeConfluence: false, maxIssues: 10 });

    expect(stats.usersScraped).toBe(2);
    expect(stats.issuesScraped).toBe(1);
    expect(jiraScraper.scrapeIssueDetails).toHaveBeenCalledWith('PROJ-1');
    expect(dataProcessor.processUserWorkload).toHaveBeenCalledTimes(2);
  });

  test('scrapeFullProject handles invalid project key', async () => {
    const stats = await orchestrator.scrapeFullProject('', {});
    expect(stats.errors.some(e => e.includes('fatal error'))).toBe(true);
  });

  test('scrapeSingleIssue returns success when issue scraped', async () => {
    const result = await orchestrator.scrapeSingleIssue('PROJ-1');
    expect(result.success).toBe(true);
  });

  test('scrapeSingleIssue returns error when issue details missing', async () => {
    jiraScraper.scrapeIssueDetails.mockResolvedValueOnce(null);
    const result = await orchestrator.scrapeSingleIssue('PROJ-1');
    expect(result.success).toBe(false);
  });

  test('updateUserWorkloads updates each user', async () => {
    const result = await orchestrator.updateUserWorkloads('PROJ');
    expect(result.success).toBe(true);
    expect(result.updated).toBe(2);
  });

  test('getScrapingStatus aggregates stats', async () => {
    const status = await orchestrator.getScrapingStatus();
    expect(status.usersWithConfluence).toBe(1);
    expect(status.resolvedIssues).toBe(1);
    expect(status.unresolvedIssues).toBe(1);
  });

  test('incrementalScrape processes updated issues', async () => {
    __mockRequestJira.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ issues: [{ key: 'PROJ-1' }] })
    });

    const result = await orchestrator.incrementalScrape('PROJ', '2024-01-01');

    expect(result.success).toBe(true);
    expect(result.issuesProcessed).toBe(1);
    expect(result.issuesFound).toBe(1);
  });
});

