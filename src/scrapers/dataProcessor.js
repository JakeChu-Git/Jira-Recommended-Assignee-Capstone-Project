import * as cache from '../cache.js';

/**
 * data processing
 * 
 * processes and stores scraped data in a normalised format
 * optimised for the assignment algorithm
 * 
 * stores:
 * - user profiles
 * - issue history
 * - workload patterns
 */

/**
 * processes and stores a single issue's data
 * extracts relevant features and stores them for algorithm use
 * 
 * @param {Object} issueData - issue data from scrapeIssueDetails
 * @param {Array} worklogs - worklogs from scrapeIssueWorklogs
 * @param {Array} comments - comments from scrapeIssueComments
 */
export async function processIssue(issueData, worklogs = [], comments = []) {
  try {
    if (!issueData || typeof issueData !== 'object') {
      console.error('no issue data provided');
      return;
    }

    const key = issueData.key || issueData.id || 'unknown';
    console.log(`processing issue: ${key}`);
    
    const summary = normaliseToPlainText(issueData.summary || '');
    const description = normaliseToPlainText(issueData.description || '');
    const labels = Array.isArray(issueData.labels) ? issueData.labels : [];
    const components = Array.isArray(issueData.components) ? issueData.components : [];
    const issueType = issueData.issueType || null;
    const assignee = issueData.assignee || null;
    const reporter = issueData.reporter || null;
    const parent = issueData.parent || null;
    const epic = issueData.epic || null;

    const processedIssue = {
      key: issueData.key,
      id: issueData.id,
      summary: summary,
      summaryTokens: tokeniseText(summary),
      description: description,
      descriptionTokens: tokeniseText(description),
      labels: labels,
      components: components,
      priority: issueData.priority || null,
      status: issueData.status || null,
      issueType: issueType,
      assignee: assignee,
      reporter: reporter,
      parent: parent,
      epic: epic,
      created: issueData.created || null,
      updated: issueData.updated || null,
      resolutionDate: issueData.resolutionDate || null,
      timeTracking: issueData.timeTracking || null,
      worklogContributors: processWorklogs(Array.isArray(worklogs) ? worklogs : []),
      commentContributors: processComments(Array.isArray(comments) ? comments : []),
      historicalAssignees: extractHistoricalAssignees(issueData.changelog)
    };

    await cache.cacheIssue(processedIssue);

    await updateUserProfilesFromIssue(processedIssue, worklogs, comments);

    console.log(`successfully processed issue: ${processedIssue.key}`);
  } catch (error) {
    console.error('error processing issue:', error);
  }
}

/**
 * processes worklogs to extract user contribution data
 * 
 * @param {Array} worklogs - array of worklog objects
 * @returns {Array} array of contributor objects with time spent
 */
function processWorklogs(worklogs) {
  const contributors = {};

  for (const log of worklogs) {
    const author = log && log.author ? log.author : null;
    const accountId = author && author.accountId ? author.accountId : null;
    const displayName = author && author.displayName ? author.displayName : 'Unknown';
    if (!accountId) continue;

    if (!contributors[accountId]) {
      contributors[accountId] = {
        accountId: accountId,
        displayName: displayName,
        timeSpentSeconds: 0,
        logCount: 0
      };
    }
    const t = Number(log.timeSpentSeconds) || 0;
    contributors[accountId].timeSpentSeconds += t;
    contributors[accountId].logCount += 1;
  }

  return Object.values(contributors);
}

/**
 * processes comments to extract user engagement data
 * 
 * @param {Array} comments - array of comment objects
 * @returns {Array} array of commenters with comment counts
 */
function processComments(comments) {
  const commenters = {};

  for (const comment of comments) {
    const author = comment && comment.author ? comment.author : null;
    const accountId = author && author.accountId ? author.accountId : null;
    const displayName = author && author.displayName ? author.displayName : 'Unknown';
    if (!accountId) continue;

    if (!commenters[accountId]) {
      commenters[accountId] = {
        accountId: accountId,
        displayName: displayName,
        commentCount: 0
      };
    }
    commenters[accountId].commentCount += 1;
  }

  return Object.values(commenters);
}

/**
 * extracts historical assignees from issue changelog
 * 
 * @param {Array|Object} changelog - issue changelog from jira
 * @returns {Array} array of historical assignee objects
 */
function extractHistoricalAssignees(changelog) {
  const assignees = [];

  const histories = Array.isArray(changelog) ? changelog
    : changelog && Array.isArray(changelog.histories) ? changelog.histories
    : [];

  for (const history of histories) {
    const items = Array.isArray(history.items) ? history.items : [];
    for (const item of items) {
      if (item && item.field === 'assignee') {
        assignees.push({
          accountId: item.to || null,
          displayName: item.toString || null,
          changedAt: history.created || null
        });
      }
    }
  }

  return assignees;
}

/**
 * tokenises text into normalised words for similarity matching
 * 
 * @param {string} text - text to tokenise
 * @returns {Array} array of normalised tokens
 */
function tokeniseText(text) {
  if (!text || typeof text !== 'string') return [];

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2)
    .filter(word => !isStopWord(word));
}

/**
 * converts various jira/confluence formats (plain strings or atlaskit adf objects)
 * into a plain text string so tokenisation can behave consistently.
 *
 * @param {any} input - content returned by jira or confluence apis
 * @returns {string} plain text representation
 */
function normaliseToPlainText(input) {
  if (!input) return '';
  if (typeof input === 'string') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map(normaliseToPlainText).join(' ').trim();
  }

  if (typeof input === 'object') {
    if (input.type === 'doc' && Array.isArray(input.content)) {
      return input.content.map(normaliseToPlainText).join(' ').trim();
    }
    if (typeof input.text === 'string') {
      return input.text;
    }
    if (Array.isArray(input.content)) {
      return input.content.map(normaliseToPlainText).join(' ').trim();
    }
  }

  return String(input);
}

/**
 * simple stop word filter
 * 
 * @param {string} word - word to check
 * @returns {boolean} true if the word is a stop word
 */
function isStopWord(word) {
  const stopWords = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all',
    'can', 'her', 'was', 'one', 'our', 'out', 'this', 'that',
    'with', 'have', 'from', 'they', 'been', 'what', 'when'
  ]);
  return stopWords.has(word);
}

/**
 * updates user profiles based on issue data
 * aggregates user work history for the assignment algorithm
 * 
 * @param {Object} issueData - processed issue data
 * @param {Array} worklogs - issue worklogs
 * @param {Array} comments - issue comments
 */
async function updateUserProfilesFromIssue(issueData, worklogs, comments) {
  try {
    const userProfiles = await cache.allUserProfiles();

    if (issueData.assignee && issueData.assignee.accountId) {
      await updateUserProfile(
        userProfiles,
        issueData.assignee.accountId,
        issueData.assignee.displayName || 'Unknown',
        issueData,
        'assigned'
      );
    }

    for (const contributor of issueData.worklogContributors) {
      if (!contributor || !contributor.accountId) continue;
      await updateUserProfile(
        userProfiles,
        contributor.accountId,
        contributor.displayName || 'Unknown',
        issueData,
        'worklogs',
        Number(contributor.timeSpentSeconds) || 0
      );
    }

    for (const commenter of issueData.commentContributors) {
      if (!commenter || !commenter.accountId) continue;
      await updateUserProfile(
        userProfiles,
        commenter.accountId,
        commenter.displayName || 'Unknown',
        issueData,
        'comments',
        Number(commenter.commentCount) || 0
      );
    }

    for (const assignee of issueData.historicalAssignees) {
      if (assignee && assignee.accountId) {
        await updateUserProfile(
          userProfiles,
          assignee.accountId,
          assignee.displayName || 'Unknown',
          issueData,
          'historical'
        );
      }
    }

    await cache.updateAllUserProfiles(userProfiles);

  } catch (error) {
    console.error('error updating user profiles:', error);
  }
}

/**
 * updates a single user's profile with issue data
 * 
 * @param {Object} userProfiles - all user profiles object
 * @param {string} accountId - user's account ID
 * @param {string} displayName - user's display name
 * @param {Object} issueData - issue data
 * @param {string} interactionType - type of interaction (assigned, worklogs, comments, historical)
 * @param {number} value - additional value (time spent, comment count, etc.)
 */
async function updateUserProfile(userProfiles, accountId, displayName, issueData, interactionType, value = 1) {
  if (!accountId) return;

  if (!userProfiles[accountId]) {
    userProfiles[accountId] = {
      accountId: accountId,
      displayName: displayName || 'Unknown',
      assignedIssues: [],
      worklogIssues: [],
      commentedIssues: [],
      historicalIssues: [],
      labels: {},
      components: {},
      issueTypes: {},
      epics: {},
      parents: {},
      totalTimeSpent: 0,
      totalComments: 0
    };
  }

  const profile = userProfiles[accountId];
  profile.assignedIssues = profile.assignedIssues ?? [];
  profile.worklogIssues = profile.worklogIssues ?? [];
  profile.commentedIssues = profile.commentedIssues ?? [];
  profile.historicalIssues = profile.historicalIssues ?? [];
  profile.labels = profile.labels ?? {};
  profile.components = profile.components ?? {};
  profile.issueTypes = profile.issueTypes ?? {};
  profile.epics = profile.epics ?? {};
  profile.parents = profile.parents ?? {};


  if (interactionType === 'assigned' && !profile.assignedIssues.includes(issueData.key)) {
    profile.assignedIssues.push(issueData.key);
  } else if (interactionType === 'worklogs' && !profile.worklogIssues.includes(issueData.key)) {
    profile.worklogIssues.push(issueData.key);
    profile.totalTimeSpent += Number(value) || 0;
  } else if (interactionType === 'comments' && !profile.commentedIssues.includes(issueData.key)) {
    profile.commentedIssues.push(issueData.key);
    profile.totalComments += Number(value) || 0;
  } else if (interactionType === 'historical' && !profile.historicalIssues.includes(issueData.key)) {
    profile.historicalIssues.push(issueData.key);
  }

  const labels = Array.isArray(issueData.labels) ? issueData.labels : [];
  labels.forEach(label => {
    const k = typeof label === 'string' ? label : String(label);
    profile.labels[k] = (profile.labels[k] || 0) + 1;
  });

  const components = Array.isArray(issueData.components) ? issueData.components : [];
  components.forEach(component => {
    const k = typeof component === 'string' ? component : (component && component.name) ? component.name : 'Unknown';
    profile.components[k] = (profile.components[k] || 0) + 1;
  });

  if (issueData.issueType) {
    const t = typeof issueData.issueType === 'string' ? issueData.issueType
      : issueData.issueType.name ? issueData.issueType.name
      : String(issueData.issueType);
    profile.issueTypes[t] = (profile.issueTypes[t] || 0) + 1;
  }

  if (issueData.epic) {
    const epicKey = typeof issueData.epic === 'string' ? issueData.epic
      : issueData.epic.key ? issueData.epic.key
      : 'Unknown';
    profile.epics[epicKey] = (profile.epics[epicKey] || 0) + 1;
  }

  if (issueData.parent) {
    const parentKey = typeof issueData.parent === 'string' ? issueData.parent
      : issueData.parent.key ? issueData.parent.key
      : 'Unknown';
    profile.parents[parentKey] = (profile.parents[parentKey] || 0) + 1;
  }
}

/**
 * processes and stores confluence page data in user profiles
 * 
 * @param {Object} pageData - page data from scrapePageDetails
 * @param {Array} contributors - contributors from scrapePageContributors
 */
export async function processConfluencePage(pageData, contributors = []) {
  try {
    if (!pageData || typeof pageData !== 'object') {
      console.error('no page data provided');
      return;
    }

    console.log(`processing confluence page: ${pageData.title || pageData.id}`);

    const userProfiles = await cache.allUserProfiles();

    for (const contributor of contributors) {
      const accountId = contributor && contributor.accountId ? contributor.accountId : null;
      if (!accountId) continue;

      if (!userProfiles[accountId]) {
        userProfiles[accountId] = {
          accountId: accountId,
          displayName: contributor.displayName || 'Unknown',
          assignedIssues: [],
          worklogIssues: [],
          commentedIssues: [],
          historicalIssues: [],
          labels: {},
          components: {},
          issueTypes: {},
          epics: {},
          parents: {},
          totalTimeSpent: 0,
          totalComments: 0,
          confluencePages: []
        };
      }

      const profile = userProfiles[accountId];

      if (!Array.isArray(profile.confluencePages)) {
        profile.confluencePages = [];
      }

      const exists = profile.confluencePages.some(p => p && p.id === pageData.id);
      if (!exists) {
        profile.confluencePages.push({
          id: pageData.id,
          title: pageData.title || '',
          spaceKey: pageData.spaceKey || '',
          labels: Array.isArray(pageData.labels) ? pageData.labels : [],
          contributionCount: Number(contributor.contributionCount) || 0,
          isCreator: Boolean(contributor.isCreator)
        });
      }
    }

    await cache.cacheUserProfile(profile);

    console.log(`successfully processed confluence page: ${pageData.title || pageData.id}`);
  } catch (error) {
    console.error('error processing confluence page:', error);
  }
}

/**
 * processes and stores user workload data
 * 
 * @param {string} accountId - user's account ID
 * @param {Object} workloadData - workload data from scrapeUserWorkload
 */
export async function processUserWorkload(accountId, workloadData) {
  try {
    if (!accountId || typeof accountId !== 'string') {
      console.error('invalid accountId for workload');
      return;
    }

    console.log(`processing workload for user: ${accountId}`);

    workloadData.lastUpdated = new Date().toISOString();
    
    await cache.cacheWorkload(accountId, workloadData);

    console.log(`successfully processed workload for user: ${accountId}`);
  } catch (error) {
    console.error('error processing user workload:', error);
  }
}

/**
 * gets scraping statistics
 * 
 * @returns {Object} statistics about scraped data
 */
export async function getScrapingStats() {
  try {
    const issues = await cache.allIssues();
    const profiles = await cache.allUserProfiles();

    return {
      totalIssues: Object.keys(issues).length,
      totalUsers: Object.keys(profiles).length,
      lastScraped: new Date().toISOString()
    };
  } catch (error) {
    console.error('error getting scraping stats:', error);
    return {};
  }
}
