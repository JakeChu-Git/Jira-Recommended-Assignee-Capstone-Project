jest.mock('@forge/api', () => {
  const mockRequestConfluence = jest.fn();
  const asApp = jest.fn(() => ({ requestConfluence: mockRequestConfluence }));
  const route = (strings, ...values) =>
    strings.reduce((acc, str, idx) => acc + str + (values[idx] ?? ''), '');
  return {
    __esModule: true,
    default: { asApp },
    asApp,
    route,
    __mockRequestConfluence: mockRequestConfluence
  };
});

import {
  searchConfluencePages,
  scrapePageDetails,
  scrapePageContributors,
  scrapePagesInSpace,
  scrapeUserPages,
  extractKeywordsFromContent
} from '../scrapers/confluenceScraper.js';
import { __mockRequestConfluence } from '@forge/api';

const mockResponse = ({ ok = true, jsonData = null, textData = '' } = {}) => ({
  ok,
  json: jest.fn().mockResolvedValue(jsonData),
  text: jest.fn().mockResolvedValue(textData)
});

describe('confluenceScraper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('searchConfluencePages maps results', async () => {
    __mockRequestConfluence.mockResolvedValueOnce(
      mockResponse({
        jsonData: {
          results: [
            {
              content: {
                id: '123',
                title: 'Page Title',
                type: 'page',
                space: { key: 'DOC', name: 'Docs' },
                version: {
                  number: 2,
                  when: '2024-01-01',
                  by: { accountId: 'user-1', displayName: 'User One' }
                }
              }
            }
          ]
        }
      })
    );

    const results = await searchConfluencePages('query', 'DOC', 5);
    expect(results[0]).toMatchObject({
      id: '123',
      title: 'Page Title',
      spaceKey: 'DOC',
      version: { number: 2 }
    });
  });

  test('scrapePageDetails returns structured data', async () => {
    __mockRequestConfluence.mockResolvedValueOnce(
      mockResponse({
        jsonData: {
          id: '456',
          title: 'Detail',
          type: 'page',
          space: { key: 'DOC', name: 'Docs' },
          body: { storage: { value: '<p>body</p>' } },
          metadata: { labels: { results: [{ name: 'label' }] } },
          history: { createdDate: '2024', createdBy: { accountId: 'u1', displayName: 'Creator' } },
          version: { number: 3, when: '2024-02', by: { accountId: 'u2', displayName: 'Updater' } }
        }
      })
    );

    const page = await scrapePageDetails('456');
    expect(page.labels).toEqual(['label']);
    expect(page.lastUpdatedBy.displayName).toBe('Updater');
  });

  test('scrapePageContributors collects creator and updater', async () => {
    __mockRequestConfluence.mockResolvedValueOnce(
      mockResponse({
        jsonData: {
          createdBy: { accountId: 'u1', displayName: 'Creator' },
          lastUpdated: { by: { accountId: 'u2', displayName: 'Updater' } }
        }
      })
    );

    const contributors = await scrapePageContributors('789');
    expect(contributors).toHaveLength(2);
    expect(contributors.find(c => c.accountId === 'u1').isCreator).toBe(true);
  });

  test('scrapePagesInSpace returns ids from first batch', async () => {
    __mockRequestConfluence.mockResolvedValueOnce(
      mockResponse({
        jsonData: {
          results: [{ id: '1' }, { id: '2' }],
          _links: {}
        }
      })
    );

    const ids = await scrapePagesInSpace('DOC', 5);
    expect(ids).toEqual(['1', '2']);
  });

  test('scrapeUserPages maps search results', async () => {
    __mockRequestConfluence.mockResolvedValueOnce(
      mockResponse({
        jsonData: {
          results: [
            {
              content: {
                id: '10',
                title: 'User Page',
                space: { key: 'DOC', name: 'Docs' },
                version: { number: 1, when: '2024-03' }
              }
            }
          ]
        }
      })
    );

    const pages = await scrapeUserPages('user-123', 5);
    expect(pages[0]).toMatchObject({ id: '10', title: 'User Page' });
  });

  test('extractKeywordsFromContent strips html and returns keywords', () => {
    const html = '<p>Testing keywords keywords extraction!</p>';
    const result = extractKeywordsFromContent(html);
    expect(result[0]).toBe('keywords');
  });
});

