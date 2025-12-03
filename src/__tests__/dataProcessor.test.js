import { processIssue, processUserWorkload } from '../scrapers/dataProcessor.js';
import * as cache from '../cache.js';

jest.mock('../cache.js', () => ({
	cacheIssue: jest.fn(),
	cacheUserProfile: jest.fn(),
	cacheWorkload: jest.fn(),
	allUserProfiles: jest.fn(),
	updateAllUserProfiles: jest.fn()
}));

const buildIssue = () => ({
	key: 'PROJ-1',
	id: '100',
	summary: 'Fix critical API bug',
	description: 'Fix the API bug affecting customers',
	labels: ['api', 'critical'],
	components: ['backend'],
	issueType: 'Bug',
	assignee: { accountId: 'user-assignee', displayName: 'Assignee User' },
	reporter: { accountId: 'user-reporter', displayName: 'Reporter User' },
	parent: { key: 'PROJ-0', summary: 'Parent summary' },
	epic: { key: 'EPIC-1', summary: 'Epic summary' },
	changelog: {
		histories: [
			{
				created: '2024-01-03',
				items: [
					{ field: 'assignee', to: 'user-hist', toString: 'Historical User' }
				]
			}
		]
	}
});

describe('dataProcessor', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('processIssue caches issue and updates user profiles', async () => {
		const issue = buildIssue();
		const worklogs = [
			{
				author: { accountId: 'user-worklog', displayName: 'Worker' },
				timeSpentSeconds: 7200
			}
		];
		const comments = [
			{
				author: { accountId: 'user-comment', displayName: 'Commenter' }
			}
		];

		const userProfiles = {};
		cache.allUserProfiles.mockResolvedValue(userProfiles);

		await processIssue(issue, worklogs, comments);

		expect(cache.cacheIssue).toHaveBeenCalledTimes(1);
		const cachedIssue = cache.cacheIssue.mock.calls[0][0];
		expect(cachedIssue.summaryTokens).toContain('fix');
		expect(cachedIssue.worklogContributors[0]).toMatchObject({
			accountId: 'user-worklog',
			displayName: 'Worker',
			timeSpentSeconds: 7200
		});
		expect(cachedIssue.commentContributors[0].accountId).toBe('user-comment');

		expect(cache.updateAllUserProfiles).toHaveBeenCalledTimes(1);
		const updatedProfiles = cache.updateAllUserProfiles.mock.calls[0][0];

		expect(updatedProfiles['user-assignee'].assignedIssues).toContain('PROJ-1');
		expect(updatedProfiles['user-worklog'].worklogIssues).toContain('PROJ-1');
		expect(updatedProfiles['user-worklog'].totalTimeSpent).toBe(7200);
		expect(updatedProfiles['user-comment'].commentedIssues).toContain('PROJ-1');
		expect(updatedProfiles['user-hist'].historicalIssues).toContain('PROJ-1');
		expect(updatedProfiles['user-assignee'].labels.api).toBe(1);
		expect(updatedProfiles['user-assignee'].components.backend).toBe(1);
	});

	test('processIssue handles missing issue data', async () => {
		await processIssue(null);
		expect(cache.cacheIssue).not.toHaveBeenCalled();
	});

	test('processUserWorkload caches workload with timestamp', async () => {
		const workload = { totalIssues: 3 };
		const before = Date.now();

		await processUserWorkload('user-123', { ...workload });

		expect(cache.cacheWorkload).toHaveBeenCalledTimes(1);
		const [accountId, storedWorkload] = cache.cacheWorkload.mock.calls[0];
		expect(accountId).toBe('user-123');
		expect(storedWorkload.totalIssues).toBe(3);
		expect(new Date(storedWorkload.lastUpdated).getTime()).toBeGreaterThanOrEqual(before);
	});

	test('processUserWorkload ignores invalid account id', async () => {
		await processUserWorkload(null, { totalIssues: 1 });
		expect(cache.cacheWorkload).not.toHaveBeenCalled();
	});
});

