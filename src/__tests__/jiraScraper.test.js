jest.mock('@forge/api', () => {
	const mockRequestJira = jest.fn();
	const asApp = jest.fn(() => ({ requestJira: mockRequestJira }));

	const buildRoute = (strings, ...values) =>
		strings.reduce((acc, str, idx) => acc + str + (values[idx] ?? ''), '');

	return {
		__esModule: true,
		default: { asApp },
		asApp,
		route: buildRoute,
		__mockRequestJira: mockRequestJira
	};
});

import {
	scrapeAssignableUsers,
	scrapeIssueDetails,
	scrapeIssueWorklogs,
	scrapeProjectIssues,
	scrapeUserWorkload
} from '../scrapers/jiraScraper.js';
import { asApp, __mockRequestJira } from '@forge/api';

const mockResponse = ({ ok = true, status = 200, jsonData = null, textData = '' } = {}) => ({
	ok,
	status,
	json: jest.fn().mockResolvedValue(jsonData),
	text: jest.fn().mockResolvedValue(textData)
});

describe('jiraScraper', () => {
	beforeEach(() => {
		__mockRequestJira.mockReset();
		asApp.mockClear();
	});

	test('scrapeAssignableUsers returns mapped users', async () => {
		const apiUsers = [
			{ accountId: '1', displayName: 'User One', emailAddress: 'one@example.com', active: true, avatarUrls: { '48x48': 'url' } },
			{ accountId: '2', displayName: 'User Two', active: false }
		];
		__mockRequestJira.mockResolvedValueOnce(mockResponse({ jsonData: apiUsers }));

		const result = await scrapeAssignableUsers('PROJ');

		expect(result).toEqual([
			{ accountId: '1', displayName: 'User One', emailAddress: 'one@example.com', active: true, avatarUrls: { '48x48': 'url' } },
			{ accountId: '2', displayName: 'User Two', emailAddress: null, active: false, avatarUrls: null }
		]);
		expect(asApp).toHaveBeenCalled();
	});

	test('scrapeAssignableUsers returns empty list for invalid project key', async () => {
		const result = await scrapeAssignableUsers(null);
		expect(result).toEqual([]);
		expect(__mockRequestJira).not.toHaveBeenCalled();
	});

	test('scrapeIssueDetails normalises fields', async () => {
		const issuePayload = {
			key: 'PROJ-1',
			id: '100',
			fields: {
				summary: 'Summary',
				description: 'Desc',
				labels: ['frontend'],
				components: [{ name: 'API' }],
				priority: { name: 'High' },
				status: { name: 'To Do' },
				issuetype: { name: 'Bug' },
				assignee: { accountId: 'u1', displayName: 'Assignee' },
				reporter: { accountId: 'u2', displayName: 'Reporter' },
				parent: { key: 'PROJ-2', fields: { summary: 'Parent' } },
				created: '2024-01-01',
				updated: '2024-01-02'
			},
			changelog: {
				histories: [
					{
						created: '2024-01-01',
						items: [
							{ field: 'assignee', toAccountId: 'u1', toString: 'Assignee' }
						]
					}
				]
			}
		};

		__mockRequestJira.mockResolvedValueOnce(mockResponse({ jsonData: issuePayload }));

		const result = await scrapeIssueDetails('PROJ-1');

		expect(result.key).toBe('PROJ-1');
		expect(result.summary).toBe('Summary');
		expect(result.issueType).toBe('Bug');
		expect(result.assignee).toEqual({ accountId: 'u1', displayName: 'Assignee' });
		expect(result.parent).toEqual({ key: 'PROJ-2', summary: 'Parent' });
	});

	test('scrapeIssueWorklogs maps response and handles errors', async () => {
		const worklogPayload = {
			worklogs: [
				{
					author: { accountId: 'w1', displayName: 'Worker' },
					timeSpentSeconds: 3600,
					created: '2024-01-01'
				}
			]
		};

		__mockRequestJira.mockResolvedValueOnce(mockResponse({ jsonData: worklogPayload }));

		const worklogs = await scrapeIssueWorklogs('PROJ-1');
		expect(worklogs).toEqual([
			{
				author: { accountId: 'w1', displayName: 'Worker' },
				timeSpentSeconds: 3600,
				created: '2024-01-01',
				updated: null,
				comment: ''
			}
		]);

		const errorResponse = mockResponse({ ok: false, textData: 'error' });
		__mockRequestJira.mockResolvedValueOnce(errorResponse);
		const fallback = await scrapeIssueWorklogs('PROJ-1');
		expect(fallback).toEqual([]);
	});

	test('scrapeProjectIssues fetches and limits issue keys', async () => {
		const issuePayload = {
			issues: [{ key: 'PROJ-1' }, { key: 'PROJ-2' }]
		};

		__mockRequestJira.mockResolvedValueOnce(mockResponse({ jsonData: issuePayload }));

		const keys = await scrapeProjectIssues('PROJ', 1);
		expect(keys).toEqual(['PROJ-1']);

		const requestArgs = __mockRequestJira.mock.calls[0];
		expect(requestArgs[1].method).toBe('POST');
	});

	test('scrapeProjectIssues returns [] on fetch error', async () => {
		const errorResponse = mockResponse({ ok: false, textData: 'failure', status: 500 });
		__mockRequestJira.mockResolvedValueOnce(errorResponse);

		const result = await scrapeProjectIssues('PROJ');
		expect(result).toEqual([]);
	});

	test('scrapeUserWorkload aggregates status and priority', async () => {
		const data = {
			total: 2,
			issues: [
				{
					fields: {
						status: { name: 'In Progress' },
						priority: { name: 'High' },
						timeestimate: 1800
					}
				},
				{
					fields: {
						status: { name: 'In Progress' },
						priority: { name: 'Medium' },
						timeestimate: 3600
					}
				}
			]
		};

		__mockRequestJira.mockResolvedValueOnce(mockResponse({ jsonData: data }));

		const workload = await scrapeUserWorkload('user-1');
		expect(workload.totalIssues).toBe(2);
		expect(workload.statusBreakdown['In Progress']).toBe(2);
		expect(workload.priorityBreakdown.High).toBe(1);
		expect(workload.priorityBreakdown.Medium).toBe(1);
		expect(workload.totalEstimateSeconds).toBe(5400);
	});

	test('scrapeUserWorkload returns defaults on API failure', async () => {
		__mockRequestJira.mockResolvedValueOnce(mockResponse({ ok: false, textData: 'error' }));
		const workload = await scrapeUserWorkload('user-1');
		expect(workload).toEqual({
			totalIssues: 0,
			statusBreakdown: {},
			priorityBreakdown: {},
			totalEstimateSeconds: 0
		});
	});
});

