import api, { route } from '@forge/api';

/**
 * jira data scraper
 * 
 * scrapes historical data from jira for the assignment algorithm
 * collects:
 * - issue details (summary, description, labels, components, etc.)
 * - user work history (who worked on which issues)
 * - parent child relationships (epics, subtasks)
 * - worklogs and time tracking
 */

/**
 * fetches all users in a project who can be assigned to issues
 * 
 * @param {string} projectKey - jira project key
 * @returns {Array} array of user objects with accountId and displayName
 */
export async function scrapeAssignableUsers(projectKey) {
  try {
    console.log(`scraping assignable users for project: ${projectKey}`);

    if (!projectKey || typeof projectKey !== 'string') {
      return [];
    }

    const res = await api.asApp().requestJira(
      route`/rest/api/3/user/assignable/search?project=${encodeURIComponent(projectKey)}&maxResults=1000`
    );

    if (!res.ok) {
      console.error('failed to fetch assignable users:', await res.text());
      return [];
    }

    const users = await res.json();

    return (Array.isArray(users) ? users : []).map(u => ({
      accountId: u.accountId,
      displayName: u.displayName,
      emailAddress: u.emailAddress || null,
      active: Boolean(u.active),
      avatarUrls: u.avatarUrls || null
    }));
  } catch (error) {
    console.error('error scraping assignable users:', error);
    return [];
  }
}

/**
 * fetches detailed information about a specific issue
 * 
 * @param {string} issueKey - jira issue key (e.g., PROJ-123)
 * @returns {Object|null} detailed issue information
 */
export async function scrapeIssueDetails(issueKey) {
  try {
    console.log(`scraping details for issue: ${issueKey}`);

    if (!issueKey || typeof issueKey !== 'string') {
      return null;
    }

    const res = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}`
    );

    if (!res.ok) {
      console.error(`failed to fetch issue ${issueKey}:`, await res.text());
      return null;
    }

    const issue = await res.json();
    const f = issue.fields || {};

    return {
      key: issue.key,
      id: issue.id,
      summary: f.summary || '',
      description: f.description || '',
      labels: Array.isArray(f.labels) ? f.labels : [],
      components: Array.isArray(f.components) ? f.components.map(c => c && c.name ? c.name : String(c)) : [],
      priority: f.priority?.name || null,
      status: f.status?.name || null,
      issueType: f.issuetype?.name || null,
      assignee: f.assignee ? {
        accountId: f.assignee.accountId,
        displayName: f.assignee.displayName
      } : null,
      reporter: f.reporter ? {
        accountId: f.reporter.accountId,
        displayName: f.reporter.displayName
      } : null,
      parent: f.parent ? {
        key: f.parent.key,
        summary: f.parent.fields?.summary || ''
      } : null,
      // epic can vary by scheme; keep optional
      epic: f.epic ? {
        key: f.epic.key,
        name: f.epic.name
      } : null,
      created: f.created || null,
      updated: f.updated || null,
      resolutionDate: f.resolutiondate || null,
      timeTracking: {
        originalEstimate: f.timeoriginalestimate || 0,
        remainingEstimate: f.timeestimate || 0,
        timeSpent: f.timespent || 0
      },
      changelog: Array.isArray(issue.changelog?.histories) ? issue.changelog.histories : []
    };
  } catch (error) {
    console.error(`error scraping issue ${issueKey}:`, error);
    return null;
  }
}

/**
 * scrapes worklogs for an issue to understand who worked on it and for how long
 * 
 * @param {string} issueKey - jira issue key
 * @returns {Array} array of worklog entries
 */
export async function scrapeIssueWorklogs(issueKey) {
  try {
    console.log(`scraping worklogs for issue: ${issueKey}`);

    if (!issueKey || typeof issueKey !== 'string') {
      return [];
    }

    const res = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/worklog`
    );

    if (!res.ok) {
      console.error(`failed to fetch worklogs for ${issueKey}:`, await res.text());
      return [];
    }

    const data = await res.json();
    const worklogs = Array.isArray(data.worklogs) ? data.worklogs : [];

    return worklogs.map(log => ({
      author: {
        accountId: log.author?.accountId || null,
        displayName: log.author?.displayName || 'Unknown'
      },
      timeSpentSeconds: Number(log.timeSpentSeconds) || 0,
      created: log.created || null,
      updated: log.updated || null,
      comment: log.comment || ''
    }));
  } catch (error) {
    console.error(`error scraping worklogs for ${issueKey}:`, error);
    return [];
  }
}

/**
 * scrapes comments on an issue to identify user engagement
 * 
 * @param {string} issueKey - jira issue key
 * @returns {Array} array of comment objects
 */
export async function scrapeIssueComments(issueKey) {
  try {
    console.log(`scraping comments for issue: ${issueKey}`);

    if (!issueKey || typeof issueKey !== 'string') {
      return [];
    }

    const res = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/comment`
    );

    if (!res.ok) {
      console.error(`failed to fetch comments for ${issueKey}:`, await res.text());
      return [];
    }

    const data = await res.json();
    const comments = Array.isArray(data.comments) ? data.comments : [];

    return comments.map(c => ({
      author: {
        accountId: c.author?.accountId || null,
        displayName: c.author?.displayName || 'Unknown'
      },
      body: c.body || '',
      created: c.created || null,
      updated: c.updated || null
    }));
  } catch (error) {
    console.error(`error scraping comments for ${issueKey}:`, error);
    return [];
  }
}

/**
 * searches for issues in a project using jql
 * bulk scrapes historical issue keys
 * 
 * @param {string} projectKey - jira project key
 * @param {number} maxResults - maximum number of issues to retrieve
 * @returns {Array} array of issue keys
 */
export async function scrapeProjectIssues(projectKey, maxResults = 1000) {
  try {
    console.log(`scraping issues for project: ${projectKey}`);

    if (!projectKey || typeof projectKey !== 'string') {
      return [];
    }

    const all = [];

    const jql = `project = ${projectKey} ORDER BY created DESC`;

    const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: `{
        "fields": ["key"],
        "jql": "${jql}",
        "maxResults": 5000
      }`
    });

    if (!res.ok) {
      console.error(res.status);
      console.error(await res.text());
      throw new Error (`failed to fetch issues`);
    }

    const data = await res.json();
    const issues = Array.isArray(data.issues) ? data.issues : [];

    all.push(...issues.map(i => i.key));

    console.log(`retrieved ${all.length} issues so far`);

    console.log(`total issues scraped: ${all.length}`);
    return all.slice(0, maxResults);
  } catch (error) {
    console.error('error scraping project issues:', error);
    return [];
  }
}

/**
 * scrapes issues assigned to a specific user to understand work history
 * 
 * @param {string} accountId - user's account id
 * @param {string|null} projectKey - optional jira project key filter
 * @param {number} maxResults - maximum number of issues to retrieve
 * @returns {Array} array of issue keys
 */
export async function scrapeUserAssignedIssues(accountId, projectKey = null, maxResults = 500) {
  try {
    console.log(`scraping issues assigned to user: ${accountId}`);

    if (!accountId || typeof accountId !== 'string') {
      return [];
    }

    let jql = `assignee = accountId("${accountId}")`;
    if (projectKey && typeof projectKey === 'string') {
      jql += ` AND project = ${projectKey}`;
    }
    jql += ' ORDER BY updated DESC';

    const encodedJql = encodeURIComponent(jql);
    const limit = Math.max(1, Math.min(maxResults || 500, 1000)); // allow bigger page if server supports, api will cap

    const res = await api.asApp().requestJira(
      route`/rest/api/3/search?jql=${encodedJql}&maxResults=${limit}&fields=key`
    );

    if (!res.ok) {
      console.error(`failed to fetch issues for user ${accountId}:`, await res.text());
      return [];
    }

    const data = await res.json();
    const issues = Array.isArray(data.issues) ? data.issues : [];

    console.log(`found ${issues.length} issues assigned to user`);
    return issues.map(i => i.key);
  } catch (error) {
    console.error('error scraping user assigned issues:', error);
    return [];
  }
}

/**
 * gets the current workload for a user by counting unresolved assigned issues
 * 
 * @param {string} accountId - user's account id
 * @param {string|null} projectKey - optional jira project key
 * @returns {Object} workload information including counts and estimates
 */
export async function scrapeUserWorkload(accountId, projectKey = null) {
  try {
    console.log(`calculating workload for user: ${accountId}`);

    if (!accountId || typeof accountId !== 'string') {
      return { totalIssues: 0, statusBreakdown: {}, priorityBreakdown: {}, totalEstimateSeconds: 0 };
    }

    let jql = `assignee = ${accountId} AND resolution = unresolved`;
    if (projectKey && typeof projectKey === 'string') {
      jql += ` AND project = ${projectKey}`;
    }

    const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: `{
        "fields": ["status", "priority", "labels"],
        "jql": "${jql}",
        "maxResults": 5000
      }`
    });

    if (!res.ok) {
      console.error(`failed to fetch workload for user ${accountId}:`, await res.text());
      return { totalIssues: 0, statusBreakdown: {}, priorityBreakdown: {}, totalEstimateSeconds: 0 };
    }

    const data = await res.json();
    const issues = Array.isArray(data.issues) ? data.issues : [];

    const statusBreakdown = {};
    const priorityBreakdown = {};
    let totalEstimate = 0;

    for (const i of issues) {
      const status = i.fields?.status?.name || 'Unknown';
      const priority = i.fields?.priority?.name || 'Unknown';
      statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
      priorityBreakdown[priority] = (priorityBreakdown[priority] || 0) + 1;
      totalEstimate += Number(i.fields?.timeestimate) || 0;
    }

    return {
      totalIssues: data.total || issues.length,
      statusBreakdown,
      priorityBreakdown,
      totalEstimateSeconds: totalEstimate
    };
  } catch (error) {
    console.error('error calculating user workload:', error);
    return { totalIssues: 0, statusBreakdown: {}, priorityBreakdown: {}, totalEstimateSeconds: 0 };
  }
}

/**
 * scrapes all epics in a project
 * 
 * @param {string} projectKey - jira project key
 * @returns {Array} array of epic details
 */
export async function scrapeProjectEpics(projectKey) {
  try {
    console.log(`scraping epics for project: ${projectKey}`);

    if (!projectKey || typeof projectKey !== 'string') {
      return [];
    }

    const jql = `project = ${projectKey} AND type = Epic ORDER BY created DESC`;
    const res = await api.asApp().requestJira(
      route`/rest/api/3/search/jql?jql=${jql}&maxResults=1000&fields=key,summary,status,assignee,labels`,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    if (!res.ok) {
      console.error('failed to fetch epics:', await res.text());
      return [];
    }

    const data = await res.json();
    const issues = Array.isArray(data.issues) ? data.issues : [];

    return issues.map(epic => ({
      key: epic.key,
      summary: epic.fields?.summary || '',
      status: epic.fields?.status?.name || null,
      assignee: epic.fields?.assignee ? {
        accountId: epic.fields.assignee.accountId,
        displayName: epic.fields.assignee.displayName
      } : null,
      labels: Array.isArray(epic.fields?.labels) ? epic.fields.labels : []
    }));
  } catch (error) {
    console.error('error scraping epics:', error);
    return [];
  }
}

/**
 * scrapes all unique labels used in a project
 *
 * @param {string} projectKey - jira project key
 * @returns {Array} array of label strings
 */
export async function scrapeProjectLabels(projectKey) {
  try {
    console.log(`scraping labels for project: ${projectKey}`);

    if (!projectKey || typeof projectKey !== 'string') {
      return [];
    }

    // Fetch all issues with labels in the project
    const jql = `project = ${projectKey} AND labels is not EMPTY ORDER BY created DESC`;
    const res = await api.asApp().requestJira(
      route`/rest/api/3/search/jql?jql=${jql}&maxResults=1000&fields=labels`,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    if (!res.ok) {
      console.error('failed to fetch labels:', await res.text());
      return [];
    }

    const data = await res.json();
    const issues = Array.isArray(data.issues) ? data.issues : [];

    // Collect all unique labels
    const labelSet = new Set();
    for (const issue of issues) {
      const labels = issue.fields?.labels || [];
      if (Array.isArray(labels)) {
        labels.forEach(label => {
          if (label && typeof label === 'string') {
            labelSet.add(label);
          }
        });
      }
    }

    const uniqueLabels = Array.from(labelSet).sort();
    console.log(`found ${uniqueLabels.length} unique labels in project ${projectKey}`);

    return uniqueLabels;
  } catch (error) {
    console.error('error scraping labels:', error);
    return [];
  }
}
