import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import * as scrapeOrchestrator from '../scrapers/scrapeOrchestrator.js';
import { checkIssueAssignee } from '../decline.js';
import {
  recommendAssignee,
  getAssignmentState as fetchAssignmentState,
  clearAssignmentState as wipeAssignmentState
} from '../assignment/autoAssign.js';
import { scrapeProjectEpics, scrapeProjectLabels } from '../scrapers/jiraScraper.js';
import { initialiseCache, resetCache } from '../cache.js';
import { generateAssignmentSummary } from '../assignment/autoAssign.js';
import { updateAutoAssignSummary } from '../index.js';

/**
 * resolver
 * 
 * this module allows backend functions to be called from the frontend
 * gives access to:
 * - data scraping functionality
 * - processed data retrieval
 * - scraping status and statistics
 * 
 */

const resolver = new Resolver();

resolver.define('checkIssueAssignee', checkIssueAssignee);

/**
 * getCurrentUser
 * 
 * Gets the current user's account information
 */
resolver.define('getCurrentUser', async (req) => {
  try {
    const response = await api.asUser().requestJira(route`/rest/api/3/myself`);
    
    if (!response.ok) {
      throw new Error(`Failed to get current user: ${response.status}`);
    }
    
    const userData = await response.json();
    
    return {
      success: true,
      user: {
        accountId: userData.accountId,
        displayName: userData.displayName,
        emailAddress: userData.emailAddress
      }
    };
  } catch (error) {
    console.error('Error getting current user:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

/**
 * getIssueAssignee
 * 
 * Gets the actual current assignee of an issue
 */
resolver.define('getIssueAssignee', async (req) => {
  try {
    const issueKey = req?.payload?.issueKey;
    
    if (!issueKey) {
      throw new Error('issueKey is required');
    }
    
    const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}?fields=assignee`);
    
    if (!response.ok) {
      throw new Error(`Failed to get issue: ${response.status}`);
    }
    
    const issueData = await response.json();
    const assignee = issueData?.fields?.assignee;
    
    return {
      success: true,
      assignee: assignee ? {
        accountId: assignee.accountId,
        displayName: assignee.displayName,
        emailAddress: assignee.emailAddress
      } : null
    };
  } catch (error) {
    console.error('Error getting issue assignee:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

/**
 * autoAssignIssue
 *
 * primary entry point for the recommendation engine. this resolver will either:
 * - return a preview of the scoring (when skipAssignment=true), or
 * - set the assignee in jira and give the candidate list.
 */
resolver.define('autoAssignIssue', async (req) => {
  try {
    const issueKey = getIssueKey(req);
    const payload = (req && typeof req.payload === 'object') ? req.payload : {};

    const previewOnly = Boolean(payload.preview);
    const result = await recommendAssignee(issueKey, {
      skipAssignment: previewOnly,
      commentOnAssignment: !previewOnly,
      commentOnDecline: Boolean(payload.commentOnDecline ?? true),
      actorDisplayName: req?.context?.principal?.displayName || null
    });

    if (result.success && result.assignee && !previewOnly) {
      const summary = generateAssignmentSummary(result.assignee);
      await updateAutoAssignSummary(issueKey, summary);
      console.log(`Updated summary for ${issueKey}: ${summary}`);
    }

    return {
      success: true,
      result
    };
  } catch (error) {
    console.error('error during autoAssignIssue resolver:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

/**
 * declineAssignment
 *
 * registers a decline for the supplied account id and immediately requests
 * the next best candidate
 */
resolver.define('declineAssignment', async (req) => {
  try {
    const issueKey = getIssueKey(req);
    const payload = (req && typeof req.payload === 'object') ? req.payload : {};
    const declinedAccountId = payload.accountId;

    if (!declinedAccountId || typeof declinedAccountId !== 'string') {
      throw new Error('accountId is required to decline a recommendation');
    }

    // set the current user to unassigned and then look for the next best user, 
    // in the case that there isnt another user found it'll stay unassigned
    await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/assignee`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: null }),
    });

    const result = await recommendAssignee(issueKey, {
      declinedAccountId,
      skipAssignment: true,  // After decline, only recommend - don't auto-assign
      commentOnAssignment: false,  // Don't post assignment comment for recommendations
      commentOnDecline: true,  // Still post the decline acknowledgment
      actorDisplayName: req?.context?.principal?.displayName || null
    });

    return {
      success: true,
      result
    };
  } catch (error) {
    console.error('error during declineAssignment resolver:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

/**
 * getAssignmentState
 *
 * lightweight helper so the frontend can query the current declined list
 * and the last recommendation that was applied.
 */
resolver.define('getAssignmentState', async (req) => {
  try {
    const issueKey = getIssueKey(req);
    const state = await fetchAssignmentState(issueKey);

    return {
      success: true,
      state
    };
  } catch (error) {
    console.error('error during getAssignmentState resolver:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

/**
 * clearAssignmentState
 *
 * endpoint to remove stored state (after assignment)
 */
resolver.define('clearAssignmentState', async (req) => {
  try {
    const issueKey = getIssueKey(req);
    await wipeAssignmentState(issueKey);

    return {
      success: true
    };
  } catch (error) {
    console.error('error during clearAssignmentState resolver:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================================
// helper functions
// ============================================================================

/**
 * gets the issue key from the request
 */
function getIssueKey(req) {
  const ctx = req?.context?.extension?.issue?.key;
  const payloadIssue = req?.payload?.issue || req?.payload?.issueKey;
  const issue = ctx || payloadIssue;
  if (!issue || typeof issue !== 'string' || !issue.includes('-')) {
    throw new Error('issue not available in context or payload');
  }
  return issue;
}

/** 
 * gets the project key from the request
 */
function getProjectKey(req) {
  const issue = getIssueKey(req);
  return issue.split('-')[0];
}

// ============================================================================
// scraping resolvers 
// ============================================================================

/**
 * scrape full project
 * gets all historical data for a project
 */
resolver.define('scrapeFullProject', async (req) => {
  try {
    console.log('resolver: scrapeFullProject called');

    const projectKey = getProjectKey(req);
    const options = (req.payload && typeof req.payload === 'object') ? (req.payload.options || {}) : {};

    console.log(`full scrape for project: ${projectKey}`);

    const results = await scrapeOrchestrator.scrapeFullProject(projectKey, options);

    return {
      success: true,
      results: results
    };
  } catch (error) {
    console.error('error in scrapeFullProject resolver:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

/**
 * scrape current issue
 * gets data for the current issue being viewed
 */
resolver.define('scrapeCurrentIssue', async (req) => {
  try {
    console.log('resolver: scrapeCurrentIssue called');

    const issue = getIssueKey(req);

    console.log(`scraping current issue: ${issue}`);

    const result = await scrapeOrchestrator.scrapeSingleIssue(issue);

    return result;
  } catch (error) {
    console.error('error in scrapeCurrentIssue resolver:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

/**
 * update workloads
 * should be called periodically to keep workload current
 */
resolver.define('updateWorkloads', async (req) => {
  try {
    console.log('resolver: updateWorkloads called');

    const projectKey = getProjectKey(req);

    console.log(`updating workloads for project: ${projectKey}`);

    const result = await scrapeOrchestrator.updateUserWorkloads(projectKey);

    return result;
  } catch (error) {
    console.error('error in updateWorkloads resolver:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

/**
 * incremental scrape
 * performs an incremental scrape to update recently changed data
 */
resolver.define('incrementalScrape', async (req) => {
  try {
    console.log('resolver: incrementalScrape called');

    const projectKey = getProjectKey(req);

    // defaults to issues updated in the last 7 days
    const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    console.log(`starting incremental scrape since: ${sinceIso}`);

    const result = await scrapeOrchestrator.incrementalScrape(projectKey, sinceIso);

    return result;
  } catch (error) {
    console.error('error in incrementalScrape resolver:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================================
// cache resolvers
// ============================================================================
resolver.define('initialiseCache', async (req) => {
  const projectKey = req.context.extension.project.key;
  await initialiseCache(projectKey);

  return true;
});

resolver.define('resetCache', async () => {
  await resetCache();
  
  return false;
});

// ============================================================================
// Admin Panel resolvers
// ============================================================================

/**
 * Fetch all epics from the current project
 */
resolver.define('getEpics', async (req) => {
  const projectKey = req.context.extension.project.key;
  const epics = await scrapeProjectEpics(projectKey);
  console.log(`Found ${epics.length} epics`);

  return {
    success: true,
    epics: epics.map(epic => ({
      key: epic.key,
      summary: epic.summary
    }))
  };
});

/**
 * Fetch all labels from the current project
 */
resolver.define('getLabels', async (req) => {
  try {
    const projectKey = req.context.extension.project.key;
    const labels = await scrapeProjectLabels(projectKey);
    console.log(`Found ${labels.length} labels`);

    return {
      success: true,
      labels: labels
    };
  } catch (error) {
    console.error('error in getLabels resolver:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

/**
 * Fetch all unassigned tasks from the current project
 */
resolver.define('getUnassignedTasks', async (req) => {
  try {
    const projectKey = req.context.extension.project.key;

    const jql = `project = ${projectKey} AND assignee is EMPTY AND type != Epic`;
    const res = await api.asApp().requestJira(
      route`/rest/api/3/search/jql?jql=${jql}&maxResults=500&fields=key,summary,issuetype`,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    if (!res.ok) {
      console.error('Failed to fetch unassigned tasks:', res);
      return {
        success: false,
        error: 'Failed to fetch unassigned tasks'
      };
    }

    const data = await res.json();
    const issues = Array.isArray(data.issues) ? data.issues : [];
    const tasks = issues.map(issue => ({
      key: issue.key,
      summary: issue.fields?.summary || '',
      issueType: issue.fields?.issuetype?.name || 'Unknown'
    }));

    console.log(`Found ${tasks.length} unassigned tasks`);
    return {
      success: true,
      tasks: tasks
    };
  } catch (error) {
    console.error('error in getUnassignedTasks resolver:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

/**
 * Auto-assign unassigned issues by mode (epic, label or task)
 * Uses the auto-assignment algorithm
 */
resolver.define('autoAssignByMode', async (req) => {
  try {
    const { mode, keys, criteria } = req.payload;
    if (!keys || keys.length === 0) {
      return {
        success: false,
        error: 'No items selected'
      };
    }

    const actorDisplayName = req?.context?.principal?.displayName || null;
    let totalProcessed = 0;
    let totalAssigned = 0;
    let totalSkipped = 0;
    const assignedIssues = [];
    const skippedIssues = [];
    const failedIssues = [];
    for (const key of keys) {
      try {
        let jql;
        if (mode === 'epic') { // JQL based on mode
          jql = `parent = ${key} AND assignee is EMPTY ORDER BY created ASC`;
        } else if (mode === 'label') {
          jql = `labels = "${key}" AND assignee is EMPTY ORDER BY created ASC`;
        } else if (mode === 'task') {
          jql = null;
        }

        let unassignedIssues = [];
        if (mode === 'task') {
          unassignedIssues = [{ key: key }];
        } else {
          // Fetch unassigned issues for epic or label mode
          const issuesResponse = await api.asUser().requestJira(
            route`/rest/api/3/search/jql?jql=${jql}&maxResults=100&fields=key,summary`,
            {
              headers: {
                'Accept': 'application/json'
              }
            }
          );

          if (!issuesResponse.ok) {
            console.error(`Failed to fetch issues for ${mode} ${key}:`, issuesResponse);
            continue;
          }

          const issuesData = await issuesResponse.json();
          unassignedIssues = Array.isArray(issuesData.issues) ? issuesData.issues : [];
          console.log(`Found ${unassignedIssues.length} unassigned issues in ${mode} ${key}`);
        }

        // Assign each unassigned issue using the algorithm
        for (const issue of unassignedIssues) {
          totalProcessed++;
          try {
            console.log(`Auto-assigning issue ${issue.key}...`);
            const assignmentResult = await recommendAssignee(issue.key, {
              skipAssignment: false,
              commentOnAssignment: true,
              commentOnDecline: false,
              actorDisplayName: actorDisplayName,
              criteria: criteria
            });

            if (assignmentResult.success && assignmentResult.assignee) {
              console.log(`Successfully assigned ${issue.key} to ${assignmentResult.assignee.displayName}`);
              totalAssigned++;
              // Update the summary
              const summary = generateAssignmentSummary(assignmentResult.assignee);
              await updateAutoAssignSummary(issue.key, summary);
              assignedIssues.push({
                key: issue.key,
                summary: issue.fields?.summary || issue.summary || '',
                assignee: assignmentResult.assignee.displayName
              });
            } else {
              console.log(`Skipped ${issue.key}: ${assignmentResult.message || 'No suitable candidate'}`);
              skippedIssues.push({
                key: issue.key,
                summary: issue.fields?.summary || issue.summary || '',
                reason: assignmentResult.message || 'No suitable candidate found'
              });
              totalSkipped++;
            }
          } catch (assignError) {
            console.error(`Error assigning issue ${issue.key}:`, assignError);
            failedIssues.push({
              key: issue.key,
              summary: issue.fields?.summary || issue.summary || '',
              error: assignError.message
            });
            totalSkipped++;
          }
        }
      } catch (itemError) {
        console.error(`Error processing ${mode} ${key}:`, itemError);
      }
    }
    console.log(`Bulk assignment complete`);

    return {
      success: true,
      totalProcessed,
      totalAssigned,
      totalSkipped,
      assignedIssues,
      skippedIssues,
      failedIssues
    };
  } catch (error) {
    console.error('Error in autoAssignByMode:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

export const handler = resolver.getDefinitions();