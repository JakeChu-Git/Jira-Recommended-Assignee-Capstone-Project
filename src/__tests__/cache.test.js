import {
	cacheIssue,
	getIssue,
	cacheUserProfile,
	allUserProfiles,
	cacheIssueSummary,
	getIssueSummary,
	cacheIssueAssignmentState,
	getIssueAssignmentState,
	cacheWorkload,
	getWorkload,
	uncacheIssue,
	resetCache,
	initialiseCache,
	cacheIssueChange
} from '../cache.js';
import { kvs } from '@forge/kvs';
import * as scrapeOrchestrator from '../scrapers/scrapeOrchestrator.js';

jest.mock('@forge/kvs', () => {
	const store = new Map();

	const kvs = {
		get: jest.fn(async key => store.get(key)),
		set: jest.fn(async (key, value) => {
			store.set(key, value);
		}),
		delete: jest.fn(async key => {
			store.delete(key);
		}),
		__reset: () => store.clear()
	};

	return { kvs };
});

const seedCacheBuckets = async () => {
	await kvs.set('issues', {});
	await kvs.set('users', {});
	await kvs.set('summaries', {});
	await kvs.set('assignmentStates', {});
	await kvs.set('workloads', {});
};

describe('cache module', () => {
	beforeEach(async () => {
		kvs.__reset();
		kvs.get.mockClear();
		kvs.set.mockClear();
		kvs.delete.mockClear();
		jest.spyOn(scrapeOrchestrator, 'scrapeFullProject').mockResolvedValue({});
		jest.spyOn(scrapeOrchestrator, 'scrapeSingleIssue').mockResolvedValue({});
		await seedCacheBuckets();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	test('cacheIssue stores issue and getIssue retrieves it', async () => {
		const issue = { key: 'TEST-1', summary: 'Sample issue' };

		await cacheIssue(issue);
		const stored = await getIssue('TEST-1');

		expect(stored).toEqual(issue);
	});

	test('cacheUserProfile stores user and allUserProfiles retrieves collection', async () => {
		const profile = { accountId: 'user-1', displayName: 'Jane Doe' };

		await cacheUserProfile(profile);
		const users = await allUserProfiles();

		expect(users['user-1']).toEqual(profile);
	});

	test('cacheIssueSummary and cacheIssueAssignmentState store related data', async () => {
		await cacheIssueSummary('TEST-2', 'Summary text');
		await cacheIssueAssignmentState('TEST-2', { currentAccountId: 'user-2' });
		await cacheWorkload('user-2', { totalIssues: 5 });

		expect(await getIssueSummary('TEST-2')).toBe('Summary text');
		expect(await getIssueAssignmentState('TEST-2')).toEqual({ currentAccountId: 'user-2' });
		expect(await getWorkload('user-2')).toEqual({ totalIssues: 5 });
	});

	test('uncacheIssue removes issue, summary, and assignment state', async () => {
		const issueKey = 'TEST-UNCACHE';
		await cacheIssue({ key: issueKey });
		await cacheIssueSummary(issueKey, 'summary');
		await cacheIssueAssignmentState(issueKey, { currentAccountId: 'user-x' });

		await uncacheIssue(issueKey);

		expect(await getIssue(issueKey)).toBeUndefined();
		expect(await getIssueSummary(issueKey)).toBeUndefined();
		expect(await getIssueAssignmentState(issueKey)).toBeUndefined();
	});

	test('resetCache clears all buckets', async () => {
		await cacheIssue({ key: 'TEST-RESET' });
		await cacheUserProfile({ accountId: 'user-reset' });

		await resetCache();

		expect(await kvs.get('issues')).toBeUndefined();
		expect(await kvs.get('users')).toBeUndefined();
		expect(await kvs.get('summaries')).toBeUndefined();
		expect(await kvs.get('assignmentStates')).toBeUndefined();
		expect(await kvs.get('workloads')).toBeUndefined();
	});

	describe('initialiseCache()', () => {
		test('initialises cache when buckets are undefined', async () => {
			kvs.__reset();
			jest.spyOn(kvs, 'set');

			await initialiseCache('PROJ');

			expect(scrapeOrchestrator.scrapeFullProject).toHaveBeenCalledWith('PROJ', {});
			expect(kvs.set).toHaveBeenCalledWith('users', {});
			expect(kvs.set).toHaveBeenCalledWith('issues', {});
			expect(kvs.set).toHaveBeenCalledWith('summaries', {});
			expect(kvs.set).toHaveBeenCalledWith('assignmentStates', {});
			expect(kvs.set).toHaveBeenCalledWith('workloads', {});
		});

		test('does not reinitialise when cache already exists', async () => {
			await seedCacheBuckets();
			await initialiseCache('PROJ');

			expect(scrapeOrchestrator.scrapeFullProject).not.toHaveBeenCalled();
		});
	});

	describe('cacheIssueChange()', () => {
		test('uncaches issue on delete event', async () => {
			const issueKey = 'TEST-DELETE';
			await cacheIssue({ key: issueKey });
			await cacheIssueSummary(issueKey, 'summary');
			await cacheIssueAssignmentState(issueKey, { currentAccountId: 'user-1' });

			await cacheIssueChange({
				eventType: 'avi:jira:deleted:issue',
				issue: { key: issueKey }
			});
			await new Promise(resolve => setImmediate(resolve));

			expect(await getIssue(issueKey)).toBeUndefined();
			expect(await getIssueSummary(issueKey)).toBeUndefined();
			expect(await getIssueAssignmentState(issueKey)).toBeUndefined();
		});

		test('scrapes single issue for non-delete events', async () => {
			await cacheIssueChange({
				eventType: 'jira:issue_updated',
				issue: { key: 'TEST-UPDATE' }
			});

			expect(scrapeOrchestrator.scrapeSingleIssue).toHaveBeenCalledWith('TEST-UPDATE');
		});
	});
});

