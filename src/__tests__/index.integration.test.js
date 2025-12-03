jest.mock('@forge/api', () => {
  const mockRequestJira = jest.fn();
  const asApp = jest.fn(() => ({ requestJira: mockRequestJira }));
  const route = (strings, ...values) =>
    strings.reduce((acc, str, idx) => acc + str + (values[idx] ?? ''), '');
  return {
    __esModule: true,
    default: { asApp },
    asApp,
    route,
    __mockRequestJira: mockRequestJira
  };
});

jest.mock('../cache.js', () => ({
  cacheIssueSummary: jest.fn(),
  getIssueSummary: jest.fn()
}));

import {
  updateAutoAssignSummary,
  autoAssignSummaryValue,
  setAutoAssignOnCreate
} from '../index.js';
import { __mockRequestJira } from '@forge/api';
import * as cache from '../cache.js';

const buildResponse = ({ ok = true, status = 200, jsonData = null, textData = '' } = {}) => ({
  ok,
  status,
  statusText: ok ? 'OK' : 'ERR',
  json: jest.fn().mockResolvedValue(jsonData),
  text: jest.fn().mockResolvedValue(textData)
});

describe('index integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('updateAutoAssignSummary()', () => {
    test('updates KVS and custom field when all steps succeed', async () => {
      const issueKey = 'PROJ-1';
      const summary = 'Auto summary';

      __mockRequestJira
        .mockResolvedValueOnce(buildResponse({ jsonData: { id: '10001' } })) // fetch issue
        .mockResolvedValueOnce(
          buildResponse({
            jsonData: [
              {
                id: 'custom-123',
                schema: { custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea/static/auto-assign-summary-field' }
              }
            ]
          })
        ) // fetch fields
        .mockResolvedValueOnce(buildResponse()); // update field

      cache.cacheIssueSummary.mockResolvedValue();
      cache.getIssueSummary.mockResolvedValueOnce(summary);

      const result = await updateAutoAssignSummary(issueKey, summary);

      expect(result).toEqual({ success: true, fullUpdate: true });
      expect(__mockRequestJira).toHaveBeenCalledTimes(3);
      expect(cache.cacheIssueSummary).toHaveBeenCalledWith(issueKey, summary);
      expect(cache.getIssueSummary).toHaveBeenCalledWith(issueKey);
    });

    test('returns kvsOnly when custom field not found', async () => {
      __mockRequestJira
        .mockResolvedValueOnce(buildResponse({ jsonData: { id: '10001' } }))
        .mockResolvedValueOnce(buildResponse({ jsonData: [] }));

      cache.cacheIssueSummary.mockResolvedValue();
      cache.getIssueSummary.mockResolvedValueOnce('summary');

      const result = await updateAutoAssignSummary('PROJ-1', 'summary');
      expect(result).toEqual({ success: true, kvsOnly: true });
    });

    test('returns error when issue fetch fails', async () => {
      __mockRequestJira.mockResolvedValueOnce(buildResponse({ ok: false, status: 404 }));
      const result = await updateAutoAssignSummary('PROJ-1', 'summary');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to fetch issue');
    });

    test('handles missing parameters early', async () => {
      const result = await updateAutoAssignSummary(null, '');
      expect(result).toEqual({ success: false, error: 'Missing parameters' });
      expect(__mockRequestJira).not.toHaveBeenCalled();
    });
  });

  describe('autoAssignSummaryValue()', () => {
    test('returns summaries per issue and default text when missing', async () => {
      cache.getIssueSummary
        .mockResolvedValueOnce('Stored summary')
        .mockResolvedValueOnce(null);

      const event = {
        issues: [
          { id: '1001', key: 'PROJ-1' },
          { id: '1002', key: 'PROJ-2' }
        ]
      };

      const result = await autoAssignSummaryValue(event);

      expect(result).toEqual(['Stored summary', 'Not yet auto-assigned']);
      expect(cache.getIssueSummary).toHaveBeenNthCalledWith(1, 'PROJ-1');
      expect(cache.getIssueSummary).toHaveBeenNthCalledWith(2, 'PROJ-2');
    });
  });

  describe('setAutoAssignOnCreate()', () => {
    test('stores default summary and updates custom field', async () => {
      const event = { issue: { id: '1001', key: 'PROJ-1' } };

      __mockRequestJira
        .mockResolvedValueOnce(
          buildResponse({
            jsonData: [
              {
                id: 'custom-123',
                schema: { custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea/static/auto-assign-summary-field' }
              }
            ]
          })
        )
        .mockResolvedValueOnce(buildResponse({ status: 204 }));

      await setAutoAssignOnCreate(event);

      expect(cache.cacheIssueSummary).toHaveBeenCalledWith('PROJ-1', 'Awaiting auto-assignment');
      expect(__mockRequestJira).toHaveBeenCalledTimes(2);
      const [, updateCall] = __mockRequestJira.mock.calls;
      expect(updateCall[1].method).toBe('PUT');
    });

    test('handles missing issue data gracefully', async () => {
      await setAutoAssignOnCreate({});
      expect(cache.cacheIssueSummary).not.toHaveBeenCalled();
    });
  });
});

