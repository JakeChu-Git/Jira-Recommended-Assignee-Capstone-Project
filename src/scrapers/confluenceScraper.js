import api, { route } from '@forge/api';

/**
 * confluence data scraper
 * 
 * scrapes data from confluence to understand user expertise
 * and contributions
 * 
 * collects:
 * - page authorship and contributors
 * - page content for keyword matching
 * - user activity on specific topics
 * 
 */

// helpers

function escapeCqlLiteral(s) {
  return String(s).replace(/"/g, '\\"');
}

/**
 * searches for confluence pages related to specific keywords
 * finds pages relevant to a jira issue's labels or title
 * 
 * @param {string} query - search query (e.g., issue title or labels)
 * @param {string|null} spaceKey - optional space key to limit search
 * @param {number} maxResults - maximum number of results to return
 * @returns {Array} array of page objects
 */
export async function searchConfluencePages(query, spaceKey = null, maxResults = 50) {
  try {
    console.log(`searching confluence pages for query: ${query}`);

    if (!query || typeof query !== 'string') {
      return [];
    }

    // filter for pages that contain the query
    const q = escapeCqlLiteral(query);
    let cql = `text ~ "${q}" AND type = page`;
    if (spaceKey && typeof spaceKey === 'string') {
      cql += ` AND space = "${escapeCqlLiteral(spaceKey)}"`;
    }

    const encoded = encodeURIComponent(cql);
    const limit = Math.max(1, Math.min(maxResults || 50, 100));

    const response = await api.asApp().requestConfluence(
      route`/wiki/rest/api/search?cql=${encoded}&limit=${limit}&expand=content.space,content.version`
    );

    // if the response is not ok, return an empty array
    if (!response.ok) {
      console.error('failed to search confluence pages:', await response.text());
      return [];
    }

    const data = await response.json();

    const results = (data.results || []).map(r => {
      // search results wrap content under r.content
      const page = r.content || r;
      return {
        id: page.id,
        title: page.title,
        type: page.type,
        spaceKey: page.space?.key,
        spaceName: page.space?.name,
        version: {
          number: page.version?.number,
          when: page.version?.when,
          by: page.version?.by ? {
            accountId: page.version.by.accountId,
            displayName: page.version.by.displayName
          } : null
        }
      };
    });

    return results;
  } catch (error) {
    console.error('error searching confluence pages:', error);
    return [];
  }
}

/**
 * gets detailed information about a specific confluence page
 * full content and metadata
 * 
 * @param {string} pageId - confluence page id
 * @returns {Object|null} detailed page information
 */
export async function scrapePageDetails(pageId) {
  try {
    console.log(`scraping details for confluence page: ${pageId}`);

    if (!pageId || typeof pageId !== 'string') {
      return null;
    }

    const response = await api.asApp().requestConfluence(
      route`/wiki/rest/api/content/${pageId}?expand=body.storage,version,space,history,metadata.labels`
    );

    if (!response.ok) {
      console.error(`failed to fetch page ${pageId}:`, await response.text());
      return null;
    }

    const page = await response.json();

    return {
      id: page.id,
      title: page.title,
      type: page.type,
      spaceKey: page.space?.key,
      spaceName: page.space?.name,
      content: page.body?.storage?.value || '',
      labels: (page.metadata?.labels?.results || []).map(label => label.name),
      created: page.history?.createdDate,
      createdBy: page.history?.createdBy ? {
        accountId: page.history.createdBy.accountId,
        displayName: page.history.createdBy.displayName
      } : null,
      lastUpdated: page.version?.when,
      lastUpdatedBy: page.version?.by ? {
        accountId: page.version.by.accountId,
        displayName: page.version.by.displayName
      } : null,
      version: page.version?.number
    };
  } catch (error) {
    console.error(`error scraping page ${pageId}:`, error);
    return null;
  }
}

/**
 * gets all contributors to a confluence page from its history summary
 * identifies users with edits or authorship on the page
 * 
 * @param {string} pageId - confluence page id
 * @returns {Array} array of contributor objects with contribution counts
 */
export async function scrapePageContributors(pageId) {
  try {
    console.log(`scraping contributors for confluence page: ${pageId}`);

    if (!pageId || typeof pageId !== 'string') {
      return [];
    }

    const response = await api.asApp().requestConfluence(
      route`/wiki/rest/api/content/${pageId}/history`
    );

    if (!response.ok) {
      console.error(`failed to fetch history for page ${pageId}:`, await response.text());
      return [];
    }

    const data = await response.json();

    const contributors = {};

    if (data.createdBy) {
      contributors[data.createdBy.accountId] = {
        accountId: data.createdBy.accountId,
        displayName: data.createdBy.displayName,
        contributionCount: 1,
        isCreator: true
      };
    }

    if (data.lastUpdated?.by && data.lastUpdated.by.accountId) {
      const accountId = data.lastUpdated.by.accountId;
      if (contributors[accountId]) {
        contributors[accountId].contributionCount++;
      } else {
        contributors[accountId] = {
          accountId: accountId,
          displayName: data.lastUpdated.by.displayName,
          contributionCount: 1,
          isCreator: false
        };
      }
    }

    return Object.values(contributors);
  } catch (error) {
    console.error('error scraping page contributors:', error);
    return [];
  }
}

/**
 * gets pages in a confluence space
 * useful for bulk scraping of a project's documentation space
 * 
 * @param {string} spaceKey - confluence space key
 * @param {number} maxResults - maximum number of pages to retrieve
 * @returns {Array} array of page ids
 */
export async function scrapePagesInSpace(spaceKey, maxResults = 500) {
  try {
    console.log(`scraping pages in space: ${spaceKey}`);

    if (!spaceKey || typeof spaceKey !== 'string') {
      return [];
    }

    const allPages = [];
    let start = 0;
    const batchSize = 100; // max allowed by confluence api

    while (allPages.length < maxResults) {
      const limit = Math.min(batchSize, maxResults - allPages.length);

      const response = await api.asApp().requestConfluence(
        route`/wiki/rest/api/content?spaceKey=${encodeURIComponent(spaceKey)}&limit=${limit}&start=${start}&type=page`
      );

      if (!response.ok) {
        console.error('failed to fetch pages in space:', await response.text());
        break;
      }

      const data = await response.json();

      const ids = (data.results || []).map(page => page.id);
      allPages.push(...ids);

      console.log(`retrieved ${allPages.length} pages so far...`);

      // stop when fewer than requested returned or there is no next link
      const noMore = !data._links || !data._links.next || ids.length < limit;
      if (noMore) {
        break;
      }

      start += limit;
    }

    console.log(`Total pages scraped: ${allPages.length}`);
    return allPages;
  } catch (error) {
    console.error('error scraping pages in space:', error);
    return [];
  }
}

/**
 * gets pages created or edited by a specific user
 * builds a profile of user expertise based on confluence activity
 * 
 * @param {string} accountId - the user's account id
 * @param {number} maxResults - maximum number of pages to retrieve
 * @returns {Array} array of page objects
 */
export async function scrapeUserPages(accountId, maxResults = 100) {
  try {
    console.log(`scraping pages for user: ${accountId}`);

    if (!accountId || typeof accountId !== 'string') {
      return [];
    }

    const id = escapeCqlLiteral(accountId);
    const cql = `type = page AND (creator in ("${id}") OR contributor in ("${id}"))`;
    const encoded = encodeURIComponent(cql);
    const limit = Math.max(1, Math.min(maxResults || 100, 100));

    const response = await api.asApp().requestConfluence(
      route`/wiki/rest/api/search?cql=${encoded}&limit=${limit}&expand=content.space,content.version`
    );

    if (!response.ok) {
      console.error(`failed to fetch pages for user ${accountId}:`, await response.text());
      return [];
    }

    const data = await response.json();

    return (data.results || []).map(r => {
      const page = r.content || r;
      return {
        id: page.id,
        title: page.title,
        spaceKey: page.space?.key,
        spaceName: page.space?.name,
        version: page.version?.number,
        lastUpdated: page.version?.when
      };
    });
  } catch (error) {
    console.error('error scraping user pages:', error);
    return [];
  }
}

/**
 * extracts keywords from confluence page content
 * simple keyword extraction that can be used to match
 * page content with issue titles or descriptions
 * 
 * @param {string} htmlContent - html content from confluence page
 * @returns {Array} array of keywords
 */
export function extractKeywordsFromContent(htmlContent) {
  try {
    const text = (htmlContent || '').replace(/<[^>]*>/g, ' ');
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3);

    const wordCount = {};
    words.forEach(word => {
      wordCount[word] = (wordCount[word] || 0) + 1;
    });

    const sortedWords = Object.entries(wordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(entry => entry[0]);

    return sortedWords;
  } catch (error) {
    console.error('error extracting keywords:', error);
    return [];
  }
}
