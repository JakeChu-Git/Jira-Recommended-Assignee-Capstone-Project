jest.mock('@forge/api', () => {
	const mockAsAppRequest = jest.fn();
	const mockAsUserRequest = jest.fn();
	const asApp = jest.fn(() => ({ requestJira: mockAsAppRequest }));
	const asUser = jest.fn(() => ({ requestJira: mockAsUserRequest }));
	const route = (strings, ...values) =>
		strings.reduce((acc, str, idx) => acc + str + (values[idx] ?? ''), '');

	return {
		__esModule: true,
		default: { asApp, asUser },
		asApp,
		asUser,
		route,
		__mockAsAppRequest: mockAsAppRequest,
		__mockAsUserRequest: mockAsUserRequest
	};
});

jest.mock('../scrapers/scrapeOrchestrator.js', () => ({
	scrapeSingleIssue: jest.fn()
}));

jest.mock('../scrapers/jiraScraper.js', () => ({
	scrapeAssignableUsers: jest.fn()
}));

jest.mock('../cache.js', () => ({
	getIssueAssignmentState: jest.fn(),
	cacheIssueAssignmentState: jest.fn(),
	allIssues: jest.fn(),
	allUserProfiles: jest.fn(),
	getWorkload: jest.fn(),
	cacheIssue: jest.fn(),
	cacheUserProfile: jest.fn(),
	updateAllUserProfiles: jest.fn()
}));

jest.mock('../decline.js', () => ({
	postComment: jest.fn()
}));

import { recommendAssignee } from '../assignment/autoAssign.js';
import * as cache from '../cache.js';
import * as jiraScraper from '../scrapers/jiraScraper.js';
import * as scrapeOrchestrator from '../scrapers/scrapeOrchestrator.js';
import { postComment } from '../decline.js';
import { __mockAsUserRequest } from '@forge/api';

const ISSUE_KEY = 'PROJ-1';

const baseIssue = {
	key: ISSUE_KEY,
	labels: ['frontend'],
	components: ['api'],
	issueType: 'Bug',
	epic: { key: 'EPIC-1' },
	parent: { key: 'PROJ-0' },
	historicalAssignees: [],
	worklogContributors: [],
	commentContributors: []
};

const baseAssignableUsers = [
	{ accountId: 'user-1', displayName: 'Alice' },
	{ accountId: 'user-2', displayName: 'Bob' }
];

const createProfiles = () => ({
	'user-1': {
		displayName: 'Alice',
		labels: { frontend: 5 },
		components: { api: 2 },
		issueTypes: { Bug: 3 },
		epics: {},
		parents: {},
		assignedIssues: [],
		worklogIssues: [],
		commentedIssues: []
	},
	'user-2': {
		displayName: 'Bob',
		labels: { frontend: 1 },
		components: {},
		issueTypes: { Bug: 1 },
		epics: {},
		parents: {},
		assignedIssues: [],
		worklogIssues: [],
		commentedIssues: []
	}
});

function seedEnvironment({
	processedIssue = baseIssue,
	assignableUsers = baseAssignableUsers,
	assignmentState = null,
	workloadByUser = {
		'user-1': { totalIssues: 1, totalEstimateSeconds: 0 },
		'user-2': { totalIssues: 5, totalEstimateSeconds: 14400 }
	}
} = {}) {
	cache.allIssues.mockImplementation(() => ({ [processedIssue.key]: processedIssue }));
	cache.allUserProfiles.mockResolvedValue(createProfiles());
	cache.getIssueAssignmentState.mockResolvedValue(assignmentState);
	cache.cacheIssueAssignmentState.mockResolvedValue();
	cache.getWorkload.mockImplementation(accountId => Promise.resolve(workloadByUser[accountId] || { totalIssues: 0, totalEstimateSeconds: 0 }));

	jiraScraper.scrapeAssignableUsers.mockResolvedValue(assignableUsers);
	scrapeOrchestrator.scrapeSingleIssue.mockResolvedValue();

	postComment.mockClear();
	__mockAsUserRequest.mockReset();
	__mockAsUserRequest.mockResolvedValue({ ok: true, text: jest.fn() });
}

describe('recommendAssignee integration', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('recommends best candidate without assignment when skipAssignment is true', async () => {
		seedEnvironment();

		const result = await recommendAssignee(ISSUE_KEY, { skipAssignment: true });

		expect(result.status).toBe('recommendation-only');
		expect(result.assignee.accountId).toBe('user-1');
		expect(scrapeOrchestrator.scrapeSingleIssue).not.toHaveBeenCalled();
		expect(postComment).not.toHaveBeenCalled();
		expect(cache.cacheIssueAssignmentState).toHaveBeenCalledWith(
			ISSUE_KEY,
			expect.objectContaining({
				currentAccountId: 'user-1',
				declinedAccountIds: []
			})
		);
	});

	test('records decline and posts acknowledgement comment', async () => {
		seedEnvironment({
			assignmentState: { declinedAccountIds: ['user-old'] }
		});

		await recommendAssignee(ISSUE_KEY, {
			skipAssignment: true,
			declinedAccountId: 'user-decline',
			actorDisplayName: 'Decliner'
		});

		expect(postComment).toHaveBeenCalledWith(
			ISSUE_KEY,
			expect.stringContaining('user-decline')
		);
		expect(cache.cacheIssueAssignmentState).toHaveBeenCalledWith(
			ISSUE_KEY,
			expect.objectContaining({
				declinedAccountIds: expect.arrayContaining(['user-old', 'user-decline']),
				currentAccountId: 'user-1'
			})
		);
	});

	test('attempts assignment and posts summary when assignment succeeds', async () => {
		seedEnvironment();

		const result = await recommendAssignee(ISSUE_KEY, { skipAssignment: false });

		expect(result.status).toBe('assigned');
		expect(__mockAsUserRequest).toHaveBeenCalledTimes(1);
		expect(scrapeOrchestrator.scrapeSingleIssue).toHaveBeenCalled();
		expect(postComment).toHaveBeenCalledWith(
			ISSUE_KEY,
			expect.stringContaining('has been recommended')
		);
		expect(cache.cacheIssueAssignmentState).toHaveBeenCalledWith(
			ISSUE_KEY,
			expect.objectContaining({
				currentAccountId: 'user-1'
			})
		);
	});

	test('returns assignment-failed when Jira rejects all candidates', async () => {
		seedEnvironment();

		__mockAsUserRequest.mockResolvedValue({
			ok: false,
			status: 400,
			text: jest.fn().mockResolvedValue('bad request')
		});

		jiraScraper.scrapeAssignableUsers
			.mockResolvedValueOnce(baseAssignableUsers)
			.mockResolvedValueOnce([]); // refresh yields no additional candidates

		const result = await recommendAssignee(ISSUE_KEY, { skipAssignment: false });

		expect(result.status).toBe('assignment-failed');
		expect(result.success).toBe(false);
		expect(result.attemptErrors).toHaveLength(1);
		expect(postComment).not.toHaveBeenCalled();
		expect(cache.cacheIssueAssignmentState).not.toHaveBeenCalled();
	});
});

