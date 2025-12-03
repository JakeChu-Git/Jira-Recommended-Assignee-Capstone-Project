import api, { route } from '@forge/api';
import * as scrapeOrchestrator from '../scrapers/scrapeOrchestrator.js';
import * as jiraScraper from '../scrapers/jiraScraper.js';
import { postComment } from '../decline.js';
import * as cache from '../cache.js';

/**
 * auto assignment engine
 *
 * this module consumes the processed data gathered by the scrapers and
 * calculates the most suitable assignee for a given issue. the logic is
 * intentionally verbose so that future maintainers can follow the reasoning.
 */

const STATE_KEY_PREFIX = 'assignment_state:';

/**
 * tuning weights for the scoring function.
 * values were chosen to prioritise domain expertise (labels, issue type)
 * while still rewarding historic interactions and penalising heavy workloads.
 */
const WEIGHTS = {
  LABEL: 3.2,
  COMPONENT: 2.4,
  ISSUE_TYPE: 2.8,
  EPIC: 1.4,
  PARENT: 1.6,
  HISTORICAL_EXACT: 5,
  DIRECT_WORKLOG: 2.5,
  DIRECT_COMMENT: 1.2,
  GENERAL_ASSIGNMENTS: 0.9,
  GENERAL_WORKLOGS: 0.7,
  GENERAL_COMMENTS: 0.5,
  WORKLOAD_OPEN_ISSUES: 0.85,
  WORKLOAD_ESTIMATE_HOURS: 0.12
};

/**
 * helper used when trimming text output for comments.
 */
const ALTERNATIVE_LIMIT = 3;

/**
 * recommends (and optionally applies) the best assignee for the supplied issue.
 *
 * @param {string} issueKey - jira issue key (e.g. FOO-123)
 * @param {Object} options - control flags for decline handling and side effects
 * @param {string|null} options.declinedAccountId - account id that just declined
 * @param {boolean} [options.skipAssignment=false] - when true we do not call jira
 * @param {boolean} [options.commentOnAssignment=true] - post summary comment
 * @param {boolean} [options.commentOnDecline=true] - post decline acknowledgement
 * @param {string|null} [options.actorDisplayName=null] - ui actor name for messaging
 * @returns {Promise<Object>} detailed result including chosen assignee and ranking
 */
export async function recommendAssignee(issueKey, options = {}) {
  const {
    declinedAccountId = null,
    skipAssignment = false,
    commentOnAssignment = true,
    commentOnDecline = true,
    actorDisplayName = null,
    criteria = null
  } = options || {};

  if (!issueKey || typeof issueKey !== 'string') {
    throw new Error('issueKey is required for recommendation');
  }

  const state = await loadAssignmentState(issueKey);

  const updatedState = declinedAccountId
    ? registerDecline(state, declinedAccountId)
    : { ...state, declinedAccountIds: new Set(state.declinedAccountIds || []) };

  if (declinedAccountId && commentOnDecline) {
    await postDeclineComment(issueKey, declinedAccountId, actorDisplayName);
  }

  if (!skipAssignment) {
    await scrapeOrchestrator.scrapeSingleIssue(issueKey);
  }
  const processedIssue = await ensureProcessedIssue(issueKey);
  if (!processedIssue) {
    throw new Error(`processed data for issue ${issueKey} is not available`);
  }

  const projectKey = deriveProjectKey(issueKey);
  const assignableUsers = await jiraScraper.scrapeAssignableUsers(projectKey);

  const assignableSource = Array.isArray(assignableUsers) ? assignableUsers.slice() : [];

  const assignableMap = new Map(assignableSource.map(user => [user.accountId, user]));

  const candidateList = await buildCandidateScores(
    processedIssue,
    assignableMap,
    updatedState.declinedAccountIds,
    criteria
  );

  const totalAssignable = assignableSource.length;
  const declinedCount = updatedState.declinedAccountIds
    ? updatedState.declinedAccountIds.size
    : 0;

  if (candidateList.length === 0) {
    if (totalAssignable > 0 && declinedCount >= totalAssignable) {
      return {
        success: false,
        status: 'declined-exhausted',
        message: 'All assignable users have been declined. Reset declines to continue.',
        declined: Array.from(updatedState.declinedAccountIds || []),
        meta: {
          totalAssignable,
          declinedCount
        }
      };
    }
    await clearAssignmentState(issueKey);
    return {
      success: false,
      status: 'no-candidate-found',
      message: 'No assignable users were suitable for this issue.',
      declined: Array.from(updatedState.declinedAccountIds || [])
    };
  }

  let bestCandidate = candidateList[0];
  let finalCandidateList = candidateList.slice();
  let attemptErrors = [];

  if (!skipAssignment) {
    const assignmentOutcome = await attemptAssignmentWithFallback({
      issueKey,
      projectKey,
      processedIssue,
      baselineDeclines: updatedState.declinedAccountIds,
      initialCandidates: candidateList
    });

    attemptErrors = assignmentOutcome.errors || [];

    if (!assignmentOutcome.success) {
      return {
        success: false,
        status: 'assignment-failed',
        message: 'Unable to assign the issue. All candidates were rejected by Jira.',
        declined: Array.from(updatedState.declinedAccountIds || []),
        attemptErrors: attemptErrors
      };
    }

    bestCandidate = assignmentOutcome.assignee;
    finalCandidateList = assignmentOutcome.remainingCandidates;
  }

  await persistAssignmentState(issueKey, {
    currentAccountId: bestCandidate.accountId,
    declinedAccountIds: Array.from(updatedState.declinedAccountIds || []),
    lastUpdated: new Date().toISOString()
  });

  if (!skipAssignment && commentOnAssignment) {
    const alternatives = finalCandidateList.slice(1, ALTERNATIVE_LIMIT + 1);
    await postAssignmentComment(issueKey, bestCandidate, alternatives, updatedState, actorDisplayName);
  }

  return {
    success: true,
    status: skipAssignment ? 'recommendation-only' : 'assigned',
    issueKey,
    assignee: bestCandidate,
    alternatives: finalCandidateList.slice(1),
    declined: Array.from(updatedState.declinedAccountIds || []),
    attemptErrors: attemptErrors
  };
}

/**
 * retrieves the stored assignment state for visibility/debugging.
 *
 * @param {string} issueKey - jira issue key
 * @returns {Promise<Object|null>} persisted state if available
 */
export async function getAssignmentState(issueKey) {
  if (!issueKey || typeof issueKey !== 'string') return null;
  const stored = cache.getIssueAssignmentState(issueKey);
  if (!stored) return null;
  const declined = new Set(Array.isArray(stored.declinedAccountIds) ? stored.declinedAccountIds : []);
  return {
    currentAccountId: stored.currentAccountId || null,
    declinedAccountIds: Array.from(declined),
    lastUpdated: stored.lastUpdated || null
  };
}

/**
 * resets any stored recommendation state for the supplied issue.
 *
 * @param {string} issueKey - jira issue key
 */
export async function clearAssignmentState(issueKey) {
  if (!issueKey || typeof issueKey !== 'string') return;
  await cache.uncacheIssueAssignmentState(issueKey);
}

/**
 * loads the previous state, defaulting to an empty structure.
 */
async function loadAssignmentState(issueKey) {
  const stored = await cache.getIssueAssignmentState(issueKey);
  if (!stored) {
    return {
      currentAccountId: null,
      declinedAccountIds: new Set()
    };
  }

  return {
    currentAccountId: stored.currentAccountId || null,
    declinedAccountIds: new Set(Array.isArray(stored.declinedAccountIds) ? stored.declinedAccountIds : []),
    lastUpdated: stored.lastUpdated || null
  };
}

/**
 * persists the supplied state object to kvs.
 */
async function persistAssignmentState(issueKey, state) {
  await cache.cacheIssueAssignmentState(issueKey, {
    currentAccountId: state.currentAccountId || null,
    declinedAccountIds: Array.isArray(state.declinedAccountIds)
      ? state.declinedAccountIds
      : Array.from(state.declinedAccountIds || []),
    lastUpdated: state.lastUpdated || new Date().toISOString()
  });
}

/**
 * records a decline in the in-memory copy of the state.
 */
function registerDecline(state, declinedAccountId) {
  const nextDeclined = new Set(state?.declinedAccountIds || []);
  if (declinedAccountId) {
    nextDeclined.add(declinedAccountId);
  }

  return {
    currentAccountId: null,
    declinedAccountIds: nextDeclined,
    lastUpdated: new Date().toISOString()
  };
}

/**
 * ensures we have processed data for the issue. if the data is missing we
 * trigger a targeted scrape and re-read from storage.
 */
async function ensureProcessedIssue(issueKey) {
  const processedIssues = await cache.allIssues();
  if (processedIssues[issueKey]) {
    return processedIssues[issueKey];
  }

  await scrapeOrchestrator.scrapeSingleIssue(issueKey);
  const refreshed = await cache.allIssues();
  return refreshed[issueKey] || null;
}

/**
 * builds and sorts the candidate list using the scoring system.
 */
async function buildCandidateScores(issue, assignableMap, declinedSet, criteria = null) {
  const profiles = await cache.allUserProfiles();
  const processedIssues = cache.allIssues();

  const candidates = [];

  for (const [accountId, user] of assignableMap.entries()) {
    if (!accountId || (declinedSet && declinedSet.has(accountId))) {
      continue;
    }

    const profile = profiles[accountId] || null;
    const workload = await cache.getWorkload(accountId) || null;

    const candidateScore = calculateCandidateScore(
      issue,
      accountId,
      user?.displayName,
      profile,
      workload,
      processedIssues,
      criteria
    );

    candidates.push(candidateScore);
  }

  candidates.sort((a, b) => {
    if (b.finalScore !== a.finalScore) {
      return b.finalScore - a.finalScore;
    }
    if (b.rawScore !== a.rawScore) {
      return b.rawScore - a.rawScore;
    }
    return (a.displayName || '').localeCompare(b.displayName || '');
  });

  return candidates;
}

/**
 * calculates feature and workload scores for a single candidate.
 */
export function calculateCandidateScore(issue, accountId, displayName, profile, workload, processedIssues, criteria = null) {
  let rawScore = 0;
  let evidence = {
    labels: [],
    components: [],
    issueTypes: [],
    epics: [],
    parents: [],
    interactions: [],
    penalties: {}
  };

  // Default to all criteria enabled if not provided
  const enabledCriteria = criteria || {
    labels: true,
    components: true,
    issueType: true,
    epic: true,
    parent: true,
    previousAssignee: true,
    worklogs: true,
    comments: true,
    overallAssignments: true,
    overallWorklogs: true,
    overallComments: true,
    workloadOpenIssues: true,
    workloadEstimateHours: true
  };

  const safeProfile = profile || {
    labels: {},
    components: {},
    issueTypes: {},
    epics: {},
    parents: {},
    assignedIssues: [],
    worklogIssues: [],
    commentedIssues: [],
    historicalIssues: []
  };

  const safeWorkload = workload || {
    totalIssues: 0,
    totalEstimateSeconds: 0
  };

  // Labels scoring
  if (enabledCriteria.labels) {
    for (const label of Array.isArray(issue.labels) ? issue.labels : []) {
      const count = Number(safeProfile.labels?.[label]) || 0;
      if (count > 0) {
        const contribution = WEIGHTS.LABEL * Math.log1p(count);
        rawScore += contribution;
        evidence.labels.push({ label, count, contribution });
      }
    }
  }

  // Components scoring
  if (enabledCriteria.components) {
    for (const component of Array.isArray(issue.components) ? issue.components : []) {
      const key = typeof component === 'string' ? component : String(component);
      const count = Number(safeProfile.components?.[key]) || 0;
      if (count > 0) {
        const contribution = WEIGHTS.COMPONENT * Math.log1p(count);
        rawScore += contribution;
        evidence.components.push({ component: key, count, contribution });
      }
    }
  }

  // Issue type scoring
  if (enabledCriteria.issueType && issue.issueType) {
    const issueTypeKey = typeof issue.issueType === 'string'
      ? issue.issueType
      : issue.issueType.name ? issue.issueType.name : String(issue.issueType);
    const count = Number(safeProfile.issueTypes?.[issueTypeKey]) || 0;
    if (count > 0) {
      const contribution = WEIGHTS.ISSUE_TYPE * Math.log1p(count);
      rawScore += contribution;
      evidence.issueTypes.push({ issueType: issueTypeKey, count, contribution });
    }
  }

  // Epic scoring
  if (enabledCriteria.epic && issue.epic?.key) {
    const epicKey = issue.epic.key;
    const count = Number(safeProfile.epics?.[epicKey]) || 0;
    if (count > 0) {
      const contribution = WEIGHTS.EPIC * Math.log1p(count);
      rawScore += contribution;
      evidence.epics.push({ epicKey, count, contribution });
    }
  }

  // Parent scoring
  if (enabledCriteria.parent && issue.parent?.key) {
    const parentKey = issue.parent.key;
    const count = Number(safeProfile.parents?.[parentKey]) || 0;
    if (count > 0) {
      const contribution = WEIGHTS.PARENT * Math.log1p(count);
      rawScore += contribution;
      evidence.parents.push({ parentKey, count, contribution });
    }
  }

  // Historical assignee scoring
  if (enabledCriteria.previousAssignee && Array.isArray(issue.historicalAssignees)) {
    const match = issue.historicalAssignees.find(entry => entry?.accountId === accountId);
    if (match) {
      rawScore += WEIGHTS.HISTORICAL_EXACT;
      evidence.interactions.push({
        type: 'historical-assignee',
        occurredAt: match.changedAt || null,
        contribution: WEIGHTS.HISTORICAL_EXACT
      });
    }
  }

  // Worklog scoring
  if (enabledCriteria.worklogs && Array.isArray(issue.worklogContributors)) {
    const logEntry = issue.worklogContributors.find(entry => entry?.accountId === accountId);
    if (logEntry) {
      const timeHours = (Number(logEntry.timeSpentSeconds) || 0) / 3600;
      const contribution = WEIGHTS.DIRECT_WORKLOG * Math.log1p(timeHours + Number(logEntry.logCount || 0));
      rawScore += contribution;
      evidence.interactions.push({
        type: 'worklog',
        hours: timeHours,
        logs: logEntry.logCount || 0,
        contribution
      });
    }
  }

  // Comment scoring
  if (enabledCriteria.comments && Array.isArray(issue.commentContributors)) {
    const commentEntry = issue.commentContributors.find(entry => entry?.accountId === accountId);
    if (commentEntry) {
      const contribution = WEIGHTS.DIRECT_COMMENT * Math.log1p(Number(commentEntry.commentCount) || 0);
      rawScore += contribution;
      evidence.interactions.push({
        type: 'comment',
        count: commentEntry.commentCount || 0,
        contribution
      });
    }
  }

  // General assignments scoring
  if (enabledCriteria.overallAssignments) {
    const assignedHistory = Array.isArray(safeProfile.assignedIssues) ? safeProfile.assignedIssues.length : 0;
    if (assignedHistory > 0) {
      const contribution = WEIGHTS.GENERAL_ASSIGNMENTS * Math.log1p(assignedHistory);
      rawScore += contribution;
      evidence.interactions.push({
        type: 'assigned-issue-count',
        count: assignedHistory,
        contribution
      });
    }
  }

  // General worklogs scoring
  if (enabledCriteria.overallWorklogs) {
    const worklogHistory = Array.isArray(safeProfile.worklogIssues) ? safeProfile.worklogIssues.length : 0;
    if (worklogHistory > 0) {
      const contribution = WEIGHTS.GENERAL_WORKLOGS * Math.log1p(worklogHistory);
      rawScore += contribution;
      evidence.interactions.push({
        type: 'worklog-issue-count',
        count: worklogHistory,
        contribution
      });
    }
  }

  // General comments scoring
  if (enabledCriteria.overallComments) {
    const commentHistory = Array.isArray(safeProfile.commentedIssues) ? safeProfile.commentedIssues.length : 0;
    if (commentHistory > 0) {
      const contribution = WEIGHTS.GENERAL_COMMENTS * Math.log1p(commentHistory);
      rawScore += contribution;
      evidence.interactions.push({
        type: 'comment-issue-count',
        count: commentHistory,
        contribution
      });
    }
  }

  const workloadPenalty = calculateWorkloadPenalty(safeWorkload, enabledCriteria);
  evidence.penalties.workload = workloadPenalty;

  return {
    accountId,
    displayName: displayName || safeProfile.displayName || 'Unknown',
    rawScore,
    workloadPenalty,
    finalScore: rawScore - workloadPenalty,
    evidence,
    workload: safeWorkload,
    profileSummary: buildProfileSummary(safeProfile, processedIssues)
  };
}

/**
 * workload penalty ensures heavily loaded users are deprioritised.
 */
function calculateWorkloadPenalty(workload, criteria = null) {
  if (!workload || typeof workload !== 'object') {
    return 0;
  }

  const enabledCriteria = criteria || {
    workloadOpenIssues: true,
    workloadEstimateHours: true
  };

  let penalty = 0;
  if (enabledCriteria.workloadOpenIssues) {
    const totalIssues = Number(workload.totalIssues) || 0;
    penalty += WEIGHTS.WORKLOAD_OPEN_ISSUES * totalIssues;
  }

  if (enabledCriteria.workloadEstimateHours) {
    const estimateHours = ((Number(workload.totalEstimateSeconds) || 0) / 3600);
    penalty += WEIGHTS.WORKLOAD_ESTIMATE_HOURS * estimateHours;
  }

  return penalty;
}

/**
 * short profile snapshot helps the ui explain why someone was picked.
 */
function buildProfileSummary(profile, processedIssues) {
  const assignedIssues = Array.isArray(profile.assignedIssues) ? profile.assignedIssues.slice(0, 5) : [];

  const examples = assignedIssues
    .map(issueKey => {
      const issue = processedIssues[issueKey];
      if (!issue) return null;
      return {
        key: issue.key,
        summary: issue.summary || '',
        issueType: issue.issueType || null
      };
    })
    .filter(Boolean);

  return {
    totalAssignedIssues: Array.isArray(profile.assignedIssues) ? profile.assignedIssues.length : 0,
    totalWorklogIssues: Array.isArray(profile.worklogIssues) ? profile.worklogIssues.length : 0,
    totalCommentIssues: Array.isArray(profile.commentedIssues) ? profile.commentedIssues.length : 0,
    examples
  };
}

/**
 * generates a concise summary explaining why an assignee was chosen.
 * this is used to populate the auto-assign summary custom field.
 * 
 * @param {Object} candidate - the chosen candidate with evidence
 * @returns {string} short summary for the custom field
 */
export function generateAssignmentSummary(candidate) {
  if (!candidate || !candidate.evidence) {
    return 'Auto-assigned';
  }

  const { evidence } = candidate;
  const reasons = [];

  if (evidence.labels.length > 0) {
    const topLabel = evidence.labels[0];
    reasons.push(`label expertise (${topLabel.labelId})`);
  }
  
  if (evidence.components.length > 0) {
    const topComponent = evidence.components[0];
    reasons.push(`component knowledge (${topComponent.componentId})`);
  }
  
  if (evidence.issueTypes.length > 0) {
    const topType = evidence.issueTypes[0];
    reasons.push(`${topType.issueType} experience`);
  }

  const historicalWork = evidence.interactions.find(i => i.type === 'historical-assignee');
  if (historicalWork) {
    reasons.push('previously assigned similar issues');
  }

  const worklogActivity = evidence.interactions.find(i => i.type === 'worklog');
  if (worklogActivity && worklogActivity.hours > 5) {
    reasons.push('significant time logged');
  }

  if (evidence.epics.length > 0) {
    reasons.push('epic familiarity');
  }
  
  if (evidence.parents.length > 0) {
    reasons.push('related parent work');
  }

  if (reasons.length === 0) {
    return `Best available (score: ${candidate.finalScore.toFixed(1)})`;
  }

  const summary = reasons.slice(0, 2).join(', ');
  return summary.charAt(0).toUpperCase() + summary.slice(1);
}

/**
 * applies the assignment via the jira rest api.
 */
async function applyAssignment(issueKey, accountId) {
  const response = await api.asUser().requestJira(
    route`/rest/api/3/issue/${issueKey}/assignee`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`failed to assign ${issueKey} to ${accountId}: ${response.status} ${body}`);
  }
}

/**
 * posts a short update when a recommendation is accepted.
 */
async function postAssignmentComment(issueKey, bestCandidate, alternatives, state, actorDisplayName) {
  const declined = Array.from(state.declinedAccountIds || []);

  const actorText = actorDisplayName ? `${actorDisplayName} triggered auto-assignment.` : 'Auto-assignment completed.';

  const primary = `${bestCandidate.displayName} has been recommended (score ${bestCandidate.finalScore.toFixed(2)}).`;

  const altText = alternatives.length > 0
    ? `Alternatives: ${alternatives.map(c => `${c.displayName} (${c.finalScore.toFixed(2)})`).join(', ')}.`
    : 'No further alternatives are currently available.';

  const declinedText = declined.length > 0
    ? `Declined so far: ${declined.join(', ')}.`
    : '';

  const message = [actorText, primary, altText, declinedText].filter(Boolean).join(' ');

  await postComment(issueKey, message);
}

/**
 * posts acknowledgement when a user declines a recommendation.
 */
async function postDeclineComment(issueKey, declinedAccountId, actorDisplayName) {
  const actorText = actorDisplayName || 'A user';
  const message = `${actorText} declined the recommendation for account ${declinedAccountId}. Looking for the next best option...`;
  await postComment(issueKey, message);
}

/**
 * helper to derive the jira project key from an issue key.
 */
function deriveProjectKey(issueKey) {
  return issueKey.split('-')[0];
}

async function attemptAssignmentWithFallback({
  issueKey,
  projectKey,
  processedIssue,
  baselineDeclines,
  initialCandidates
}) {
  const errors = [];
  const baselineSet = new Set(baselineDeclines || []);
  const temporaryExclusions = new Set();
  let workingCandidates = initialCandidates.slice();

  while (workingCandidates.length > 0) {
    const candidate = workingCandidates.shift();
    try {
      await applyAssignment(issueKey, candidate.accountId);
      await scrapeOrchestrator.scrapeSingleIssue(issueKey);

      return {
        success: true,
        assignee: candidate,
        remainingCandidates: [candidate, ...workingCandidates],
        errors
      };
    } catch (error) {
      errors.push({
        accountId: candidate.accountId,
        message: error.message
      });

      temporaryExclusions.add(candidate.accountId);

      const refreshedAssignable = await jiraScraper.scrapeAssignableUsers(projectKey);
      const refreshedMap = new Map(refreshedAssignable.map(user => [user.accountId, user]));

      workingCandidates = await buildCandidateScores(
        processedIssue,
        refreshedMap,
        new Set([...baselineSet, ...temporaryExclusions])
      );
    }
  }

  return {
    success: false,
    errors
  };
}
