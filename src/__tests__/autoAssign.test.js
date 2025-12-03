import { generateAssignmentSummary, calculateCandidateScore } from '../assignment/autoAssign.js';
jest.mock('@forge/api');
jest.mock('@forge/kvs');

describe('generateAssignmentSummary()', () => {
  test('includes all evidence types in summary', () => {
    const candidate = {
      displayName: 'Expert User',
      finalScore: 25.0,
      evidence: {
        labels: [{ labelId: 'frontend', label: 'frontend', count: 5, contribution: 3.2 }],
        components: [{ componentId: 'auth-service', component: 'auth-service', count: 3, contribution: 2.4 }],
        issueTypes: [{ issueType: 'Bug', count: 10, contribution: 2.8 }],
        epics: [{ epicKey: 'EPIC-123', count: 5, contribution: 2.3 }],
        parents: [{ parentKey: 'PROJ-100', count: 3, contribution: 1.8 }],
        interactions: [
          { type: 'historical-assignee', contribution: 5.0 },
          { type: 'worklog', hours: 8.5, contribution: 2.5 }
        ]
      }
    };

    const summary = generateAssignmentSummary(candidate);
    expect(summary).toContain('Label expertise');
    expect(summary.charAt(0)).toBe(summary.charAt(0).toUpperCase());
  });

  test('returns default summary when no evidence', () => {
    const candidate = {
      displayName: 'New User',
      finalScore: 5.0,
      evidence: { labels: [], components: [], issueTypes: [], epics: [], parents: [], interactions: [] }
    };

    const summary = generateAssignmentSummary(candidate);
    expect(summary).toContain('Best available');
    expect(summary).toContain('5.0');
  });

  test('handles null/undefined candidate gracefully', () => {
    expect(generateAssignmentSummary(null)).toBe('Auto-assigned');
    expect(generateAssignmentSummary(undefined)).toBe('Auto-assigned');
    expect(generateAssignmentSummary({ displayName: 'Test', finalScore: 3.0 })).toBe('Auto-assigned');
  });

  test('limits summary to top 2 reasons and handles worklog threshold', () => {
    const candidate = {
      displayName: 'Multi Expert',
      finalScore: 25.0,
      evidence: {
        labels: [{ labelId: 'frontend', label: 'frontend', count: 10, contribution: 7.4 }],
        components: [{ componentId: 'auth-service', component: 'auth-service', count: 8, contribution: 5.2 }],
        issueTypes: [{ issueType: 'Bug', count: 15, contribution: 8.1 }],
        epics: [],
        parents: [],
        interactions: [
          { type: 'worklog', hours: 6, logs: 3, contribution: 2.5 }
        ]
      }
    };

    const summary = generateAssignmentSummary(candidate);
    const commaCount = (summary.match(/,/g) || []).length;
    expect(commaCount).toBeLessThanOrEqual(1); // Top 2 reasons max
    // Summary prioritizes labels and components, so worklog won't appear in top 2
    expect(summary).toContain('Label expertise');
  });
});

describe('calculateCandidateScore() - Core Scoring', () => {
  test('awards points for all scoring factors', () => {
    const issue = {
      labels: ['frontend', 'react'],
      components: ['auth-service'],
      issueType: 'Bug',
      epic: { key: 'EPIC-123' },
      parent: { key: 'PROJ-100' },
      historicalAssignees: [{ accountId: 'user123', changedAt: '2024-01-01' }],
      worklogContributors: [{ accountId: 'user123', timeSpentSeconds: 14400, logCount: 2 }],
      commentContributors: [{ accountId: 'user123', commentCount: 5 }]
    };

    const profile = {
      labels: { 'frontend': 10, 'react': 8 },
      components: { 'auth-service': 12 },
      issueTypes: { 'Bug': 15 },
      epics: { 'EPIC-123': 5 },
      parents: { 'PROJ-100': 3 },
      assignedIssues: ['ISSUE-1', 'ISSUE-2'],
      worklogIssues: ['ISSUE-3'],
      commentedIssues: ['ISSUE-4']
    };

    const workload = { totalIssues: 5, totalEstimateSeconds: 18000 };

    const result = calculateCandidateScore(issue, 'user123', 'Expert', profile, workload, {}, null);

    expect(result.rawScore).toBeGreaterThan(0);
    expect(result.evidence.labels.length).toBe(2);
    expect(result.evidence.components.length).toBe(1);
    expect(result.evidence.issueTypes.length).toBe(1);
    expect(result.evidence.epics.length).toBe(1);
    expect(result.evidence.parents.length).toBe(1);
    expect(result.evidence.interactions.length).toBeGreaterThan(3);
    expect(result.workloadPenalty).toBeGreaterThan(0);
    expect(result.finalScore).toBeLessThan(result.rawScore);
  });

  test('handles zero matches and empty data', () => {
    const issue = {
      labels: ['backend'],
      components: ['database'],
      issueType: 'Story',
      historicalAssignees: [],
      worklogContributors: [],
      commentContributors: []
    };

    const profile = {
      labels: { 'frontend': 5 },
      components: {},
      issueTypes: {},
      epics: {},
      parents: {},
      assignedIssues: [],
      worklogIssues: [],
      commentedIssues: []
    };

    const result = calculateCandidateScore(issue, 'user123', 'Test User', profile, null, {}, null);

    expect(result.evidence.labels.length).toBe(0);
    expect(result.evidence.components.length).toBe(0);
    expect(result.rawScore).toBe(0);
  });
});

describe('calculateCandidateScore() - Data Validation', () => {
  test('handles null/undefined inputs gracefully', () => {
    const issue = {
      labels: ['frontend'],
      components: [],
      issueType: 'Story',
      historicalAssignees: [],
      worklogContributors: [],
      commentContributors: []
    };

    const result = calculateCandidateScore(issue, 'user123', null, null, null, {}, null);
    expect(result.rawScore).toBe(0);
    expect(result.displayName).toBe('Unknown');
  });

  test('handles invalid data types', () => {
    const issue = {
      labels: 'not-an-array',
      components: 'not-an-array',
      issueType: 12345,
      historicalAssignees: undefined,
      worklogContributors: null,
      commentContributors: []
    };

    const profile = {
      labels: { 'frontend': 5 },
      components: {},
      issueTypes: {},
      epics: {},
      parents: {},
      assignedIssues: 'not-an-array',
      worklogIssues: [],
      commentedIssues: []
    };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, null);
    expect(result.evidence.labels.length).toBe(0);
    expect(result.evidence.components.length).toBe(0);
  });

  test('handles issueType as object with name property', () => {
    const issue = {
      labels: [],
      components: [],
      issueType: { name: 'Bug', id: '10001' },
      historicalAssignees: [],
      worklogContributors: [],
      commentContributors: []
    };

    const profile = {
      labels: {},
      components: {},
      issueTypes: { 'Bug': 10 },
      epics: {},
      parents: {},
      assignedIssues: [],
      worklogIssues: [],
      commentedIssues: []
    };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, null);
    expect(result.evidence.issueTypes.length).toBe(1);
    expect(result.evidence.issueTypes[0].issueType).toBe('Bug');
  });

  test('handles epic/parent without key property', () => {
    const issue = {
      labels: [],
      components: [],
      issueType: 'Story',
      epic: { name: 'Some Epic' },
      parent: { id: '10001' },
      historicalAssignees: [],
      worklogContributors: [],
      commentContributors: []
    };

    const profile = {
      labels: {},
      components: {},
      issueTypes: {},
      epics: { 'EPIC-123': 5 },
      parents: { 'PROJ-100': 3 },
      assignedIssues: [],
      worklogIssues: [],
      commentedIssues: []
    };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, null);
    expect(result.evidence.epics.length).toBe(0);
    expect(result.evidence.parents.length).toBe(0);
  });
});

describe('calculateCandidateScore() - Workload Penalty', () => {
  test('applies penalty for high workload', () => {
    const issue = { labels: ['frontend'], components: [], issueType: 'Story', historicalAssignees: [], worklogContributors: [], commentContributors: [] };
    const profile = { labels: { 'frontend': 5 }, components: {}, issueTypes: {}, epics: {}, parents: {}, assignedIssues: [], worklogIssues: [], commentedIssues: [] };
    const workload = { totalIssues: 10, totalEstimateSeconds: 144000 };

    const result = calculateCandidateScore(issue, 'user123', 'Busy User', profile, workload, {}, null);

    expect(result.workloadPenalty).toBeGreaterThan(0);
    expect(result.finalScore).toBeLessThan(result.rawScore);
  });

  test('handles workload edge cases', () => {
    const issue = { labels: ['frontend'], components: [], issueType: 'Story', historicalAssignees: [], worklogContributors: [], commentContributors: [] };
    const profile = { labels: { 'frontend': 5 }, components: {}, issueTypes: {}, epics: {}, parents: {}, assignedIssues: [], worklogIssues: [], commentedIssues: [] };

    // Null workload
    const result1 = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, null);
    expect(result1.workloadPenalty).toBe(0);

    // Zero workload
    const result2 = calculateCandidateScore(issue, 'user123', 'Test', profile, { totalIssues: 0, totalEstimateSeconds: 0 }, {}, null);
    expect(result2.workloadPenalty).toBe(0);

    // Invalid workload (not an object) - covers line 527
    const result3 = calculateCandidateScore(issue, 'user123', 'Test', profile, 'not-an-object', {}, null);
    expect(result3.workloadPenalty).toBe(0);

    // Invalid numeric values
    const result4 = calculateCandidateScore(issue, 'user123', 'Test', profile, { totalIssues: 'invalid', totalEstimateSeconds: 'invalid' }, {}, null);
    expect(result4.workloadPenalty).toBe(0);
  });

  test('respects disabled workload criteria', () => {
    const issue = { labels: [], components: [], issueType: 'Story', historicalAssignees: [], worklogContributors: [], commentContributors: [] };
    const profile = { labels: {}, components: {}, issueTypes: {}, epics: {}, parents: {}, assignedIssues: [], worklogIssues: [], commentedIssues: [] };
    const workload = { totalIssues: 10, totalEstimateSeconds: 144000 };
    const criteria = { labels: true, components: true, issueType: true, epic: true, parent: true, previousAssignee: true, worklogs: true, comments: true, overallAssignments: true, overallWorklogs: true, overallComments: true, workloadOpenIssues: false, workloadEstimateHours: false };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, workload, {}, criteria);
    expect(result.workloadPenalty).toBe(0);
  });
});

describe('calculateCandidateScore() - Criteria Filtering', () => {
  const createTestIssue = () => ({
    labels: ['frontend'],
    components: ['auth-service'],
    issueType: 'Bug',
    epic: { key: 'EPIC-123' },
    parent: { key: 'PROJ-100' },
    historicalAssignees: [{ accountId: 'user123', changedAt: '2024-01-01' }],
    worklogContributors: [{ accountId: 'user123', timeSpentSeconds: 14400, logCount: 2 }],
    commentContributors: [{ accountId: 'user123', commentCount: 5 }]
  });

  const createTestProfile = () => ({
    labels: { 'frontend': 5 },
    components: { 'auth-service': 3 },
    issueTypes: { 'Bug': 10 },
    epics: { 'EPIC-123': 5 },
    parents: { 'PROJ-100': 3 },
    assignedIssues: ['ISSUE-1'],
    worklogIssues: ['ISSUE-2'],
    commentedIssues: ['ISSUE-3']
  });

  test('respects all disabled criteria', () => {
    const issue = createTestIssue();
    const profile = createTestProfile();
    const criteria = {
      labels: false,
      components: false,
      issueType: false,
      epic: false,
      parent: false,
      previousAssignee: false,
      worklogs: false,
      comments: false,
      overallAssignments: false,
      overallWorklogs: false,
      overallComments: false,
      workloadOpenIssues: true,
      workloadEstimateHours: true
    };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, criteria);

    expect(result.rawScore).toBe(0);
    expect(result.evidence.labels.length).toBe(0);
    expect(result.evidence.components.length).toBe(0);
    expect(result.evidence.issueTypes.length).toBe(0);
    expect(result.evidence.epics.length).toBe(0);
    expect(result.evidence.parents.length).toBe(0);
    expect(result.evidence.interactions.length).toBe(0);
  });

  test('respects individual disabled criteria', () => {
    const issue = createTestIssue();
    const profile = createTestProfile();

    // Test labels disabled
    const criteria1 = { labels: false, components: true, issueType: true, epic: true, parent: true, previousAssignee: true, worklogs: true, comments: true, overallAssignments: true, overallWorklogs: true, overallComments: true, workloadOpenIssues: true, workloadEstimateHours: true };
    const result1 = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, criteria1);
    expect(result1.evidence.labels.length).toBe(0);
    expect(result1.rawScore).toBeGreaterThan(0); // Other factors still score

    // Test components disabled
    const criteria2 = { labels: true, components: false, issueType: true, epic: true, parent: true, previousAssignee: true, worklogs: true, comments: true, overallAssignments: true, overallWorklogs: true, overallComments: true, workloadOpenIssues: true, workloadEstimateHours: true };
    const result2 = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, criteria2);
    expect(result2.evidence.components.length).toBe(0);
  });
});

describe('calculateCandidateScore() - Interactions', () => {
  test('handles historical assignee with and without changedAt', () => {
    const issue = {
      labels: [],
      components: [],
      issueType: 'Story',
      historicalAssignees: [
        { accountId: 'user123', changedAt: '2024-01-01' },
        { accountId: 'user456' }
      ],
      worklogContributors: [],
      commentContributors: []
    };

    const profile = { labels: {}, components: {}, issueTypes: {}, epics: {}, parents: {}, assignedIssues: [], worklogIssues: [], commentedIssues: [] };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, null);
    expect(result.evidence.interactions.find(i => i.type === 'historical-assignee')).toBeDefined();
    expect(result.evidence.interactions.find(i => i.type === 'historical-assignee').occurredAt).toBe('2024-01-01');

    const result2 = calculateCandidateScore(issue, 'user456', 'Test', profile, null, {}, null);
    expect(result2.evidence.interactions.find(i => i.type === 'historical-assignee')).toBeDefined();
    expect(result2.evidence.interactions.find(i => i.type === 'historical-assignee').occurredAt).toBeNull();
  });

  test('handles worklog with missing fields', () => {
    const issue = {
      labels: [],
      components: [],
      issueType: 'Story',
      historicalAssignees: [],
      worklogContributors: [
        { accountId: 'user123', timeSpentSeconds: 0, logCount: 0 },
        { accountId: 'user456', timeSpentSeconds: 14400 },
        { accountId: 'user789', logCount: 3 }
      ],
      commentContributors: []
    };

    const profile = { labels: {}, components: {}, issueTypes: {}, epics: {}, parents: {}, assignedIssues: [], worklogIssues: [], commentedIssues: [] };

    const result1 = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, null);
    const worklog1 = result1.evidence.interactions.find(i => i.type === 'worklog');
    expect(worklog1).toBeDefined();
    expect(worklog1.hours).toBe(0);
    expect(worklog1.logs).toBe(0);

    const result2 = calculateCandidateScore(issue, 'user456', 'Test', profile, null, {}, null);
    const worklog2 = result2.evidence.interactions.find(i => i.type === 'worklog');
    expect(worklog2.logs).toBe(0);
  });

  test('handles comment with missing fields', () => {
    const issue = {
      labels: [],
      components: [],
      issueType: 'Story',
      historicalAssignees: [],
      worklogContributors: [],
      commentContributors: [
        { accountId: 'user123', commentCount: 0 },
        { accountId: 'user456' }
      ]
    };

    const profile = { labels: {}, components: {}, issueTypes: {}, epics: {}, parents: {}, assignedIssues: [], worklogIssues: [], commentedIssues: [] };

    const result1 = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, null);
    const comment1 = result1.evidence.interactions.find(i => i.type === 'comment');
    expect(comment1).toBeDefined();
    expect(comment1.count).toBe(0);

    const result2 = calculateCandidateScore(issue, 'user456', 'Test', profile, null, {}, null);
    const comment2 = result2.evidence.interactions.find(i => i.type === 'comment');
    expect(comment2.count).toBe(0);
  });
});

describe('calculateCandidateScore() - Profile Summary', () => {
  test('builds profile summary correctly', () => {
    const issue = { labels: [], components: [], issueType: 'Story', historicalAssignees: [], worklogContributors: [], commentContributors: [] };
    const profile = {
      labels: {},
      components: {},
      issueTypes: {},
      epics: {},
      parents: {},
      assignedIssues: ['ISSUE-1', 'ISSUE-2', 'ISSUE-3', 'ISSUE-4', 'ISSUE-5', 'ISSUE-6'],
      worklogIssues: ['ISSUE-7'],
      commentedIssues: ['ISSUE-8']
    };

    const processedIssues = {
      'ISSUE-1': { key: 'ISSUE-1', summary: 'Test 1', issueType: 'Story' },
      'ISSUE-2': { key: 'ISSUE-2', summary: 'Test 2', issueType: 'Bug' },
      'ISSUE-3': { key: 'ISSUE-3', summary: 'Test 3', issueType: 'Task' },
      'ISSUE-4': { key: 'ISSUE-4', summary: 'Test 4', issueType: 'Story' },
      'ISSUE-5': { key: 'ISSUE-5', summary: 'Test 5', issueType: 'Story' }
    };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, null, processedIssues, null);

    expect(result.profileSummary.totalAssignedIssues).toBe(6);
    expect(result.profileSummary.totalWorklogIssues).toBe(1);
    expect(result.profileSummary.totalCommentIssues).toBe(1);
    expect(result.profileSummary.examples.length).toBe(5); // Limited to 5
    expect(result.profileSummary.examples.every(e => e !== null)).toBe(true);
  });

  test('handles missing processed issues in profile summary', () => {
    const issue = { labels: [], components: [], issueType: 'Story', historicalAssignees: [], worklogContributors: [], commentContributors: [] };
    const profile = {
      labels: {},
      components: {},
      issueTypes: {},
      epics: {},
      parents: {},
      assignedIssues: ['ISSUE-1', 'MISSING-1'],
      worklogIssues: [],
      commentedIssues: []
    };

    const processedIssues = {
      'ISSUE-1': { key: 'ISSUE-1', summary: 'Test 1', issueType: 'Story' }
    };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, null, processedIssues, null);
    expect(result.profileSummary.examples.length).toBe(1);
  });
});

describe('calculateCandidateScore() - Display Name', () => {
  test('uses provided displayName, falls back to profile, then Unknown', () => {
    const issue = { labels: [], components: [], issueType: 'Story', historicalAssignees: [], worklogContributors: [], commentContributors: [] };
    const profile = { labels: {}, components: {}, issueTypes: {}, epics: {}, parents: {}, assignedIssues: [], worklogIssues: [], commentedIssues: [] };

    const result1 = calculateCandidateScore(issue, 'user123', 'Provided Name', profile, null, {}, null);
    expect(result1.displayName).toBe('Provided Name');

    const profileWithName = { ...profile, displayName: 'Profile Name' };
    const result2 = calculateCandidateScore(issue, 'user123', null, profileWithName, null, {}, null);
    expect(result2.displayName).toBe('Profile Name');

    const result3 = calculateCandidateScore(issue, 'user123', null, profile, null, {}, null);
    expect(result3.displayName).toBe('Unknown');
  });
});

describe('calculateCandidateScore() - Component Type Handling', () => {
  test('handles component as non-string value', () => {
    const issue = {
      labels: [],
      components: [12345, { id: 'comp-1' }],
      issueType: 'Story',
      historicalAssignees: [],
      worklogContributors: [],
      commentContributors: []
    };

    const profile = {
      labels: {},
      components: {
        '12345': 3,
        '[object Object]': 2
      },
      issueTypes: {},
      epics: {},
      parents: {},
      assignedIssues: [],
      worklogIssues: [],
      commentedIssues: []
    };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, null);
    expect(result.evidence.components.length).toBeGreaterThan(0);
  });
});

describe('calculateCandidateScore() - Additional Edge Cases', () => {
  test('handles profile with undefined properties (not null)', () => {
    const issue = {
      labels: ['frontend'],
      components: ['auth-service'],
      issueType: 'Bug',
      historicalAssignees: [],
      worklogContributors: [],
      commentContributors: []
    };

    const profile = {
      // Missing labels, components, etc. - should use optional chaining safely
      assignedIssues: [],
      worklogIssues: [],
      commentedIssues: []
    };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, null);
    expect(result.evidence.labels.length).toBe(0);
    expect(result.evidence.components.length).toBe(0);
    expect(result.rawScore).toBe(0);
  });

  test('handles zero count values in profile', () => {
    const issue = {
      labels: ['frontend'],
      components: ['auth-service'],
      issueType: 'Bug',
      historicalAssignees: [],
      worklogContributors: [],
      commentContributors: []
    };

    const profile = {
      labels: { 'frontend': 0 },
      components: { 'auth-service': 0 },
      issueTypes: { 'Bug': 0 },
      epics: {},
      parents: {},
      assignedIssues: [],
      worklogIssues: [],
      commentedIssues: []
    };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, null);
    expect(result.evidence.labels.length).toBe(0);
    expect(result.evidence.components.length).toBe(0);
    expect(result.evidence.issueTypes.length).toBe(0);
  });

  test('handles negative values gracefully', () => {
    const issue = {
      labels: ['frontend'],
      components: [],
      issueType: 'Story',
      historicalAssignees: [],
      worklogContributors: [],
      commentContributors: []
    };

    const profile = {
      labels: { 'frontend': -5 },
      components: {},
      issueTypes: {},
      epics: {},
      parents: {},
      assignedIssues: [],
      worklogIssues: [],
      commentedIssues: []
    };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, null);
    // Negative count should not contribute (count > 0 check)
    expect(result.evidence.labels.length).toBe(0);
  });

  test('handles very large values without overflow', () => {
    const issue = {
      labels: ['frontend'],
      components: [],
      issueType: 'Story',
      historicalAssignees: [],
      worklogContributors: [],
      commentContributors: []
    };

    const profile = {
      labels: { 'frontend': 1000000 },
      components: {},
      issueTypes: {},
      epics: {},
      parents: {},
      assignedIssues: [],
      worklogIssues: [],
      commentedIssues: []
    };

    const workload = {
      totalIssues: 10000,
      totalEstimateSeconds: 36000000 // 10000 hours
    };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, workload, {}, null);
    expect(result.rawScore).toBeGreaterThan(0);
    expect(result.workloadPenalty).toBeGreaterThan(0);
    expect(Number.isFinite(result.finalScore)).toBe(true);
    expect(Number.isNaN(result.finalScore)).toBe(false);
  });

  test('handles issueType as object without name property', () => {
    const issue = {
      labels: [],
      components: [],
      issueType: { id: '10001' }, // No name property
      historicalAssignees: [],
      worklogContributors: [],
      commentContributors: []
    };

    const profile = {
      labels: {},
      components: {},
      issueTypes: { '[object Object]': 10 }, // Matches the stringified object
      epics: {},
      parents: {},
      assignedIssues: [],
      worklogIssues: [],
      commentedIssues: []
    };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, null);
    // Should convert to string '[object Object]' and match
    expect(result.evidence.issueTypes.length).toBe(1);
    expect(result.evidence.issueTypes[0].issueType).toBe('[object Object]');
  });

  test('handles workload with only one criteria enabled', () => {
    const issue = { labels: [], components: [], issueType: 'Story', historicalAssignees: [], worklogContributors: [], commentContributors: [] };
    const profile = { labels: {}, components: {}, issueTypes: {}, epics: {}, parents: {}, assignedIssues: [], worklogIssues: [], commentedIssues: [] };
    const workload = { totalIssues: 10, totalEstimateSeconds: 144000 };

    // Only open issues enabled
    const criteria1 = { labels: true, components: true, issueType: true, epic: true, parent: true, previousAssignee: true, worklogs: true, comments: true, overallAssignments: true, overallWorklogs: true, overallComments: true, workloadOpenIssues: true, workloadEstimateHours: false };
    const result1 = calculateCandidateScore(issue, 'user123', 'Test', profile, workload, {}, criteria1);
    expect(result1.workloadPenalty).toBeGreaterThan(0);

    // Only estimate hours enabled
    const criteria2 = { labels: true, components: true, issueType: true, epic: true, parent: true, previousAssignee: true, worklogs: true, comments: true, overallAssignments: true, overallWorklogs: true, overallComments: true, workloadOpenIssues: false, workloadEstimateHours: true };
    const result2 = calculateCandidateScore(issue, 'user123', 'Test', profile, workload, {}, criteria2);
    expect(result2.workloadPenalty).toBeGreaterThan(0);
  });

  test('handles optional chaining with undefined profile properties', () => {
    const issue = {
      labels: ['frontend'],
      components: ['auth-service'],
      issueType: 'Bug',
      epic: { key: 'EPIC-123' },
      parent: { key: 'PROJ-100' },
      historicalAssignees: [],
      worklogContributors: [],
      commentContributors: []
    };

    const profile = {
      labels: undefined,
      components: undefined,
      issueTypes: undefined,
      epics: undefined,
      parents: undefined,
      assignedIssues: undefined,
      worklogIssues: undefined,
      commentedIssues: undefined
    };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, null);
    expect(result.evidence.labels.length).toBe(0);
    expect(result.evidence.components.length).toBe(0);
    expect(result.rawScore).toBe(0);
  });

  test('handles invalid numeric conversions gracefully', () => {
    const issue = {
      labels: ['frontend'],
      components: [],
      issueType: 'Story',
      historicalAssignees: [],
      worklogContributors: [
        { accountId: 'user123', timeSpentSeconds: 'not-a-number', logCount: 'not-a-number' }
      ],
      commentContributors: [
        { accountId: 'user123', commentCount: 'not-a-number' }
      ]
    };

    const profile = {
      labels: { 'frontend': 'not-a-number' },
      components: {},
      issueTypes: {},
      epics: {},
      parents: {},
      assignedIssues: [],
      worklogIssues: [],
      commentedIssues: []
    };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, null, {}, null);
    // Number() converts to NaN, then || 0 makes it 0, so count > 0 check fails
    expect(result.evidence.labels.length).toBe(0);
    expect(result.workloadPenalty).toBe(0);
  });

  test('verifies final score calculation formula', () => {
    const issue = {
      labels: ['frontend'],
      components: [],
      issueType: 'Story',
      historicalAssignees: [],
      worklogContributors: [],
      commentContributors: []
    };

    const profile = {
      labels: { 'frontend': 5 },
      components: {},
      issueTypes: {},
      epics: {},
      parents: {},
      assignedIssues: [],
      worklogIssues: [],
      commentedIssues: []
    };

    const workload = {
      totalIssues: 5,
      totalEstimateSeconds: 18000
    };

    const result = calculateCandidateScore(issue, 'user123', 'Test', profile, workload, {}, null);
    // Verify: finalScore = rawScore - workloadPenalty
    const expectedFinalScore = result.rawScore - result.workloadPenalty;
    expect(result.finalScore).toBeCloseTo(expectedFinalScore, 5);
    expect(result.finalScore).toBeLessThanOrEqual(result.rawScore);
  });
});
