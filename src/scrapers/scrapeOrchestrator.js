import api, { route } from '@forge/api';
import * as jiraScraper from './jiraScraper.js';
import * as confluenceScraper from './confluenceScraper.js';
import * as dataProcessor from './dataProcessor.js';
import * as cache from '../cache.js';

/**
 * scrape orchestrator
 * 
 * coordinates scraping across jira and confluence in an optimal order
 * aims to minimise api calls while gathering enough signal for assignment
 */

/**
 * orchestrates a full scrape of a jira project
 * 
 * @param {string} projectKey - jira project key to scrape
 * @param {Object} options - scraping options
 * @returns {Promise<Object>} scraping results and statistics
 */
export async function scrapeFullProject(projectKey, options = {}) {
  const {
    maxIssues = 1000,
    includeConfluence = true,
    confluenceSpaceKey = null,
    clearExistingData = false
  } = options;

  console.log(`starting full project scrape for: ${projectKey}`);
  console.log('options:', options);

  const stats = {
    startTime: new Date().toISOString(),
    projectKey: projectKey,
    issuesScraped: 0,
    usersScraped: 0,
    epicsScraped: 0,
    confluencePagesScraped: 0,
    errors: []
  };

  try {
    if (!projectKey || typeof projectKey !== 'string') {
      throw new Error('invalid projectKey');
    }

    // step 1: optionally clear existing processed data
    if (clearExistingData) {
      console.log('clearing existing data...');
      await cache.resetCache();
    }

    // step 2: assignable users
    console.log('step 1/6: scraping assignable users...');
    const users = await jiraScraper.scrapeAssignableUsers(projectKey);

    await Promise.all(users.map((userData) => cache.cacheUserProfile(userData)));

    stats.usersScraped = users.length;
    console.log(`found ${users.length} assignable users`);

    // step 3: project epics
    console.log('step 2/6: scraping project epics...');
    const epics = await jiraScraper.scrapeProjectEpics(projectKey);
    stats.epicsScraped = epics.length;
    console.log(`found ${epics.length} epics`);

    // step 4: project issues
    console.log('step 3/6: scraping project issues...');
    const issueKeys = await jiraScraper.scrapeProjectIssues(projectKey, maxIssues);
    console.log(`found ${issueKeys.length} issues to process`);

    // step 5: per issue detail, worklogs, comments
    console.log('step 4/6: processing issue details...');
    let processedCount = 0;

    for (const issueKey of issueKeys) {
      try {
        const issueData = await jiraScraper.scrapeIssueDetails(issueKey);
        if (!issueData) {
          stats.errors.push(`failed to scrape issue: ${issueKey}`);
          continue;
        }

        const worklogs = await jiraScraper.scrapeIssueWorklogs(issueKey);
        const comments = await jiraScraper.scrapeIssueComments(issueKey);

        await dataProcessor.processIssue(issueData, worklogs, comments);

        processedCount += 1;
        if (processedCount % 10 === 0) {
          console.log(`processed ${processedCount}/${issueKeys.length} issues...`);
        }
      } catch (err) {
        console.error(`error processing issue ${issueKey}:`, err);
        stats.errors.push(`error processing issue ${issueKey}: ${err.message}`);
      }
    }

    stats.issuesScraped = processedCount;
    console.log(`successfully processed ${processedCount} issues`);

    // step 6: user workloads
    console.log('step 5/6: scraping user workloads...');
    for (const user of users) {
      try {
        const workload = await jiraScraper.scrapeUserWorkload(user.accountId, projectKey);
        await dataProcessor.processUserWorkload(user.accountId, workload);
      } catch (err) {
        console.error(`error scraping workload for user ${user.accountId}:`, err);
        stats.errors.push(`error scraping workload for ${user.displayName}: ${err.message}`);
      }
    }

    // Could not figure out Confluence API; client did not further advise
    // on or request its use.

    // step 7: confluence data
    // if (includeConfluence) {
    //   console.log('step 6/6: scraping confluence data...');
    //   stats.confluencePagesScraped = await scrapeConfluenceData(users, confluenceSpaceKey, stats);
    // } else {
    //   console.log('step 6/6: skipping confluence scraping (disabled)');
    // }

    stats.endTime = new Date().toISOString();
    stats.duration = new Date(stats.endTime) - new Date(stats.startTime);

    console.log('full project scrape completed');
    console.log('statistics:', stats);

    return stats;
  } catch (error) {
    console.error('fatal error during project scrape:', error);
    stats.errors.push(`fatal error: ${error.message}`);
    stats.endTime = new Date().toISOString();
    return stats;
  }
}

/**
 * scrapes confluence data for all users or a space
 * 
 * @param {Array} users - array of user objects
 * @param {string|null} spaceKey - optional space key filter
 * @param {Object} stats - stats object to update with errors
 * @returns {number} number of pages scraped
 */
async function scrapeConfluenceData(users, spaceKey, stats) {
  let totalPages = 0;

  try {
    if (spaceKey && typeof spaceKey === 'string') {
      console.log(`scraping pages in space: ${spaceKey}`);
      const pageIds = await confluenceScraper.scrapePagesInSpace(spaceKey, 100);

      for (const pageId of pageIds) {
        try {
          const pageData = await confluenceScraper.scrapePageDetails(pageId);
          const contributors = await confluenceScraper.scrapePageContributors(pageId);

          if (pageData) {
            await dataProcessor.processConfluencePage(pageData, contributors);
            totalPages += 1;
          }
        } catch (err) {
          console.error(`error processing confluence page ${pageId}:`, err);
          stats.errors.push(`error processing confluence page ${pageId}: ${err.message}`);
        }
      }
    } else {
      // limit user based scraping to avoid long runs in early stage
      const sample = Array.isArray(users) ? users.slice(0, 20) : [];

      for (const user of sample) {
        try {
          const userPages = await confluenceScraper.scrapeUserPages(user.accountId, 10);

          for (const page of userPages) {
            try {
              const pageData = await confluenceScraper.scrapePageDetails(page.id);
              const contributors = await confluenceScraper.scrapePageContributors(page.id);

              if (pageData) {
                await dataProcessor.processConfluencePage(pageData, contributors);
                totalPages += 1;
              }
            } catch (err) {
              console.error(`error processing page ${page.id}:`, err);
            }
          }
        } catch (err) {
          console.error(`error scraping pages for user ${user.accountId}:`, err);
        }
      }
    }

    console.log(`scraped ${totalPages} confluence pages`);
  } catch (error) {
    console.error('error during confluence scraping:', error);
    stats.errors.push(`confluence scraping error: ${error.message}`);
  }

  return totalPages;
}

/**
 * scrapes data for a single issue and its context
 * useful for real time scraping from an issue view
 * 
 * @param {string} issueKey - issue key to scrape
 * @returns {Object} processed issue status
 */
export async function scrapeSingleIssue(issueKey) {
  console.log(`scraping single issue: ${issueKey}`);

  try {
    if (!issueKey || typeof issueKey !== 'string') {
      throw new Error('invalid issueKey');
    }

    const issueData = await jiraScraper.scrapeIssueDetails(issueKey);
    if (!issueData) {
      throw new Error('failed to scrape issue details');
    }

    const worklogs = await jiraScraper.scrapeIssueWorklogs(issueKey);
    const comments = await jiraScraper.scrapeIssueComments(issueKey);

    await dataProcessor.processIssue(issueData, worklogs, comments);

    console.log(`successfully scraped issue: ${issueKey}`);
    return {
      success: true,
      issueKey: issueKey,
      data: issueData
    };
  } catch (error) {
    console.error(`error scraping issue ${issueKey}:`, error);
    return {
      success: false,
      issueKey: issueKey,
      error: error.message
    };
  }
}

/**
 * updates workload data for all users in a project
 * run periodically to keep workload current
 * 
 * @param {string} projectKey - jira project key
 * @returns {Object} update statistics
 */
export async function updateUserWorkloads(projectKey) {
  console.log(`updating user workloads for project: ${projectKey}`);

  try {
    if (!projectKey || typeof projectKey !== 'string') {
      return { success: false, error: 'invalid projectKey' };
    }

    const users = await jiraScraper.scrapeAssignableUsers(projectKey);

    let successCount = 0;
    const errors = [];

    for (const user of users) {
      try {
        const workload = await jiraScraper.scrapeUserWorkload(user.accountId, projectKey);
        await dataProcessor.processUserWorkload(user.accountId, workload);
        successCount += 1;
      } catch (err) {
        console.error(`error updating workload for ${user.displayName}:`, err);
        errors.push({ user: user.displayName, error: err.message });
      }
    }

    console.log(`updated workloads for ${successCount}/${users.length} users`);

    return {
      success: true,
      totalUsers: users.length,
      updated: successCount,
      errors: errors
    };
  } catch (error) {
    console.error('error updating user workloads:', error);
    return { success: false, error: error.message };
  }
}

/**
 * gets current scraping status and summary statistics
 * 
 * @returns {Object} scraping status and statistics
 */
export async function getScrapingStatus() {
  try {
    const stats = await dataProcessor.getScrapingStats();
    const allProfiles = await cache.allUserProfiles();
    const allIssues = await cache.allIssues();

    const profilesArr = Object.values(allProfiles || {});
    const issuesArr = Object.values(allIssues || {});

    const usersWithConfluence = profilesArr.filter(
      p => Array.isArray(p.confluencePages) && p.confluencePages.length > 0
    ).length;

    const resolvedIssues = issuesArr.filter(
      i => i && i.resolutionDate !== null
    ).length;

    return {
      ...stats,
      usersWithConfluence,
      resolvedIssues,
      unresolvedIssues: (stats.totalIssues || 0) - resolvedIssues
    };
  } catch (error) {
    console.error('error getting scraping status:', error);
    return { error: error.message };
  }
}

/**
 * performs an incremental scrape of recently updated issues
 * 
 * @param {string} projectKey - jira project key
 * @param {string} sinceDate - iso date string for lower bound
 * @returns {Object} update statistics
 */
export async function incrementalScrape(projectKey, sinceDate) {
  console.log(`starting incremental scrape for ${projectKey} since ${sinceDate}`);

  try {
    if (!projectKey || typeof projectKey !== 'string') {
      return { success: false, error: 'invalid projectKey' };
    }
    if (!sinceDate || typeof sinceDate !== 'string') {
      return { success: false, error: 'invalid sinceDate' };
    }

    const jql = `project = ${projectKey} AND updated >= "${sinceDate}" ORDER BY updated DESC`;
    const encodedJql = encodeURIComponent(jql);

    const res = await api.asApp().requestJira(
      route`/rest/api/3/search?jql=${encodedJql}&maxResults=1000&fields=key`
    );

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`failed to search for updated issues: ${txt}`);
    }

    const data = await res.json();
    const issueKeys = Array.isArray(data.issues) ? data.issues.map(i => i.key) : [];

    console.log(`found ${issueKeys.length} updated issues`);

    let processedCount = 0;
    const errors = [];

    for (const issueKey of issueKeys) {
      const result = await scrapeSingleIssue(issueKey);
      if (result.success) {
        processedCount += 1;
      } else {
        errors.push(result.error);
      }
    }

    await updateUserWorkloads(projectKey);

    return {
      success: true,
      issuesFound: issueKeys.length,
      issuesProcessed: processedCount,
      errors: errors
    };
  } catch (error) {
    console.error('error during incremental scrape:', error);
    return { success: false, error: error.message };
  }
}
