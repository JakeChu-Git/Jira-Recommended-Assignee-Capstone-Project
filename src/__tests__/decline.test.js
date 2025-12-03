import { checkIssueAssignee, postComment, notifyOnAssignment } from '../decline.js';
import api, { route } from '@forge/api';

jest.mock('@forge/api');

describe('checkIssueAssignee()', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('returns true when issue is assigned', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({
				fields: {
					assignee: {
						accountId: 'user123',
						displayName: 'Test User'
					}
				}
			})
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const result = await checkIssueAssignee({ payload: { issueKey: 'PROJ-123' } });

		expect(result).toBe(true);
		expect(api.asApp).toHaveBeenCalled();
		expect(mockResponse.json).toHaveBeenCalled();
	});

	test('returns false when issue is not assigned', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({
				fields: {
					assignee: null
				}
			})
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const result = await checkIssueAssignee({ payload: { issueKey: 'PROJ-123' } });

		expect(result).toBe(false);
	});

	test('returns true when assignee field is undefined (undefined !== null)', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({
				fields: {}
			})
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const result = await checkIssueAssignee({ payload: { issueKey: 'PROJ-123' } });

		// undefined !== null is true, so returns true
		expect(result).toBe(true);
	});

	test('returns true when fields is missing (undefined !== null)', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({})
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const result = await checkIssueAssignee({ payload: { issueKey: 'PROJ-123' } });

		// undefined !== null is true, so returns true
		expect(result).toBe(true);
	});

	test('returns true when response is null (undefined !== null)', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue(null)
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const result = await checkIssueAssignee({ payload: { issueKey: 'PROJ-123' } });

		// undefined !== null is true, so returns true
		expect(result).toBe(true);
	});

	test('handles API errors gracefully', async () => {
		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockRejectedValue(new Error('API Error'))
		});

		await expect(checkIssueAssignee({ payload: { issueKey: 'PROJ-123' } })).rejects.toThrow('API Error');
	});

	test('handles invalid payload structure', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({
				fields: {
					assignee: null
				}
			})
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		// Missing payload
		await expect(checkIssueAssignee({})).rejects.toThrow();
	});

	test('handles missing issueKey in payload', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({
				fields: {
					assignee: null
				}
			})
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		// Will construct route with undefined, which may or may not throw depending on route implementation
		// The function will attempt to call the API with undefined issueKey
		const result = await checkIssueAssignee({ payload: {} });
		// Result depends on API behavior, but function doesn't explicitly throw
		expect(typeof result).toBe('boolean');
	});
});

describe('postComment()', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('successfully posts a comment', async () => {
		const mockCommentResponse = {
			id: 'comment-123',
			body: { type: 'doc', content: [] },
			created: '2024-01-01T00:00:00.000Z'
		};

		const mockResponse = {
			json: jest.fn().mockResolvedValue(mockCommentResponse)
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const result = await postComment('PROJ-123', 'Test message');

		expect(result).toEqual(mockCommentResponse);
		expect(api.asApp).toHaveBeenCalled();
		expect(mockResponse.json).toHaveBeenCalled();

		const requestJiraCall = api.asApp().requestJira.mock.calls[0];
		expect(requestJiraCall[0]).toBeDefined();
		expect(requestJiraCall[1].method).toBe('POST');
		expect(requestJiraCall[1].headers['Content-Type']).toBe('application/json');

		const body = JSON.parse(requestJiraCall[1].body);
		expect(body.body.type).toBe('doc');
		expect(body.body.version).toBe(1);
		expect(body.body.content[0].type).toBe('paragraph');
		expect(body.body.content[0].content[0].text).toBe('Test message');
		expect(body.body.content[0].content[0].type).toBe('text');
	});

	test('posts comment with empty message', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({ id: 'comment-123' })
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const result = await postComment('PROJ-123', '');

		expect(result).toBeDefined();
		const requestJiraCall = api.asApp().requestJira.mock.calls[0];
		const body = JSON.parse(requestJiraCall[1].body);
		expect(body.body.content[0].content[0].text).toBe('');
	});

	test('posts comment with special characters', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({ id: 'comment-123' })
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const specialMessage = 'Test with "quotes" & <tags> & unicode: 🎉';
		const result = await postComment('PROJ-123', specialMessage);

		expect(result).toBeDefined();
		const requestJiraCall = api.asApp().requestJira.mock.calls[0];
		const body = JSON.parse(requestJiraCall[1].body);
		expect(body.body.content[0].content[0].text).toBe(specialMessage);
	});

	test('posts comment with multiline message', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({ id: 'comment-123' })
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const multilineMessage = 'Line 1\nLine 2\nLine 3';
		const result = await postComment('PROJ-123', multilineMessage);

		expect(result).toBeDefined();
		const requestJiraCall = api.asApp().requestJira.mock.calls[0];
		const body = JSON.parse(requestJiraCall[1].body);
		expect(body.body.content[0].content[0].text).toBe(multilineMessage);
	});

	test('handles API errors', async () => {
		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockRejectedValue(new Error('API Error'))
		});

		await expect(postComment('PROJ-123', 'Test message')).rejects.toThrow('API Error');
	});

	test('handles invalid issueKey', async () => {
		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockRejectedValue(new Error('Issue not found'))
		});

		await expect(postComment('INVALID-123', 'Test message')).rejects.toThrow('Issue not found');
	});

	test('handles null message', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({ id: 'comment-123' })
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const result = await postComment('PROJ-123', null);

		expect(result).toBeDefined();
		const requestJiraCall = api.asApp().requestJira.mock.calls[0];
		const body = JSON.parse(requestJiraCall[1].body);
		expect(body.body.content[0].content[0].text).toBeNull();
	});

	test('handles undefined message', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({ id: 'comment-123' })
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const result = await postComment('PROJ-123', undefined);

		expect(result).toBeDefined();
		const requestJiraCall = api.asApp().requestJira.mock.calls[0];
		const body = JSON.parse(requestJiraCall[1].body);
		expect(body.body.content[0].content[0].text).toBeUndefined();
	});

	test('handles very long message', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({ id: 'comment-123' })
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const longMessage = 'A'.repeat(10000);
		const result = await postComment('PROJ-123', longMessage);

		expect(result).toBeDefined();
		const requestJiraCall = api.asApp().requestJira.mock.calls[0];
		const body = JSON.parse(requestJiraCall[1].body);
		expect(body.body.content[0].content[0].text).toBe(longMessage);
	});

	test('verifies correct ADF structure', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({ id: 'comment-123' })
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		await postComment('PROJ-123', 'Test message');

		const requestJiraCall = api.asApp().requestJira.mock.calls[0];
		const body = JSON.parse(requestJiraCall[1].body);

		// Verify ADF structure
		expect(body.body).toBeDefined();
		expect(body.body.type).toBe('doc');
		expect(body.body.version).toBe(1);
		expect(Array.isArray(body.body.content)).toBe(true);
		expect(body.body.content.length).toBeGreaterThan(0);
		expect(body.body.content[0].type).toBe('paragraph');
		expect(Array.isArray(body.body.content[0].content)).toBe(true);
		expect(body.body.content[0].content[0].type).toBe('text');
	});
});

describe('notifyOnAssignment()', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('posts comment when issue is assigned (to !== null)', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({ id: 'comment-123' })
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const event = {
			issue: { key: 'PROJ-123' },
			changelog: {
				items: [
					{
						field: 'assignee',
						from: null,
						to: 'user123'
					}
				]
			}
		};

		await notifyOnAssignment(event);

		expect(api.asApp).toHaveBeenCalled();
		const requestJiraCall = api.asApp().requestJira.mock.calls[0];
		expect(requestJiraCall[0]).toBeDefined();

		const body = JSON.parse(requestJiraCall[1].body);
		expect(body.body.content[0].content[0].text).toBe('This issue has been assigned.');
	});

	test('does not post comment when to is null', async () => {
		const event = {
			issue: { key: 'PROJ-123' },
			changelog: {
				items: [
					{
						field: 'assignee',
						from: 'user123',
						to: null
					}
				]
			}
		};

		await notifyOnAssignment(event);

		expect(api.asApp).not.toHaveBeenCalled();
	});

	test('posts comment when to is undefined (undefined !== null)', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({ id: 'comment-123' })
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const event = {
			issue: { key: 'PROJ-123' },
			changelog: {
				items: [
					{
						field: 'assignee',
						from: 'user123',
						to: undefined
					}
				]
			}
		};

		await notifyOnAssignment(event);

		// undefined !== null is true, so posts comment
		expect(api.asApp).toHaveBeenCalled();
	});

	test('handles missing changelog', async () => {
		const event = {
			issue: { key: 'PROJ-123' }
		};

		await expect(notifyOnAssignment(event)).rejects.toThrow();
	});

	test('handles null changelog', async () => {
		const event = {
			issue: { key: 'PROJ-123' },
			changelog: null
		};

		await expect(notifyOnAssignment(event)).rejects.toThrow();
	});

	test('handles missing items array', async () => {
		const event = {
			issue: { key: 'PROJ-123' },
			changelog: {}
		};

		await expect(notifyOnAssignment(event)).rejects.toThrow();
	});

	test('handles empty items array', async () => {
		const event = {
			issue: { key: 'PROJ-123' },
			changelog: {
				items: []
			}
		};

		await expect(notifyOnAssignment(event)).rejects.toThrow();
	});

	test('handles missing issue key', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({ id: 'comment-123' })
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const event = {
			issue: {},
			changelog: {
				items: [
					{
						field: 'assignee',
						from: null,
						to: 'user123'
					}
				]
			}
		};

		// Will call postComment with undefined key, which may or may not throw
		await notifyOnAssignment(event);
		// Function doesn't explicitly throw, it just calls postComment
		expect(api.asApp).toHaveBeenCalled();
	});

	test('handles null issue', async () => {
		const event = {
			issue: null,
			changelog: {
				items: [
					{
						field: 'assignee',
						from: null,
						to: 'user123'
					}
				]
			}
		};

		await expect(notifyOnAssignment(event)).rejects.toThrow();
	});

	test('posts comment for non-assignee field if to !== null', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({ id: 'comment-123' })
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const event = {
			issue: { key: 'PROJ-123' },
			changelog: {
				items: [
					{
						field: 'status',
						from: 'To Do',
						to: 'In Progress'
					}
				]
			}
		};

		// Function checks changedFields[0].to !== null, not the field type
		// So it will post comment if to is not null
		await notifyOnAssignment(event);
		expect(api.asApp).toHaveBeenCalled();
	});

	test('checks first changelog item only', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({ id: 'comment-123' })
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const event = {
			issue: { key: 'PROJ-123' },
			changelog: {
				items: [
					{
						field: 'status',
						from: 'To Do',
						to: 'In Progress'
					},
					{
						field: 'assignee',
						from: null,
						to: 'user123'
					}
				]
			}
		};

		await notifyOnAssignment(event);

		// Function checks changedFields[0].to !== null (first item)
		// First item has to !== null, so posts comment
		expect(api.asApp).toHaveBeenCalled();
	});

	test('handles API errors during notification', async () => {
		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockRejectedValue(new Error('API Error'))
		});

		const event = {
			issue: { key: 'PROJ-123' },
			changelog: {
				items: [
					{
						field: 'assignee',
						from: null,
						to: 'user123'
					}
				]
			}
		};

		await expect(notifyOnAssignment(event)).rejects.toThrow('API Error');
	});

	test('handles assignment from one user to another', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({ id: 'comment-123' })
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const event = {
			issue: { key: 'PROJ-123' },
			changelog: {
				items: [
					{
						field: 'assignee',
						from: 'user123',
						to: 'user456'
					}
				]
			}
		};

		await notifyOnAssignment(event);

		expect(api.asApp).toHaveBeenCalled();
		const requestJiraCall = api.asApp().requestJira.mock.calls[0];
		const body = JSON.parse(requestJiraCall[1].body);
		expect(body.body.content[0].content[0].text).toBe('This issue has been assigned.');
	});

	test('handles string "null" as to value', async () => {
		const event = {
			issue: { key: 'PROJ-123' },
			changelog: {
				items: [
					{
						field: 'assignee',
						from: 'user123',
						to: 'null' // String, not actual null
					}
				]
			}
		};

		await notifyOnAssignment(event);

		// String 'null' is truthy, so should post comment
		expect(api.asApp).toHaveBeenCalled();
	});

	test('posts comment when to is empty string (empty string !== null)', async () => {
		const mockResponse = {
			json: jest.fn().mockResolvedValue({ id: 'comment-123' })
		};

		api.asApp = jest.fn().mockReturnValue({
			requestJira: jest.fn().mockResolvedValue(mockResponse)
		});

		const event = {
			issue: { key: 'PROJ-123' },
			changelog: {
				items: [
					{
						field: 'assignee',
						from: 'user123',
						to: '' // Empty string !== null is true
					}
				]
			}
		};

		await notifyOnAssignment(event);

		// Empty string !== null is true, so posts comment
		expect(api.asApp).toHaveBeenCalled();
	});
});

