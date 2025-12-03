export { handler } from './resolvers';
import api, { route } from '@forge/api';
import * as cache from './cache.js';

/**
 * updates the auto-assign summary custom field with the assignment reason
 * USES ISSUE ID (not key) for KVS storage to match what Jira provides
 * 
 * @param {string} issueKey 
 * @param {string} summary 
 */
export async function updateAutoAssignSummary(issueKey, summary) {
  if (!issueKey || !summary) {
    console.log('updateAutoAssignSummary: missing issueKey or summary');
    return { success: false, error: 'Missing parameters' };
  }

  console.log(`[START] updateAutoAssignSummary for ${issueKey}: "${summary}"`);

  try {
    console.log(`[1/5] Fetching issue to get ID...`);
    const issueResponse = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`);
    
    if (!issueResponse.ok) {
      throw new Error(`Failed to fetch issue: ${issueResponse.status}`);
    }
    
    const issueData = await issueResponse.json();
    const issueId = issueData.id;
    console.log(`[1/5] Issue ID: ${issueId}`);

    console.log(`[2/5] Storing in KVS: ${issueKey} = "${summary}"`);
    
    await cache.cacheIssueSummary(issueKey, summary);
    
    const verification = await cache.getIssueSummary(issueKey);
    if (verification !== summary) {
      console.error(`[2/5] KVS VERIFICATION FAILED! Expected: "${summary}", Got: "${verification}"`);

      await cache.cacheIssueSummary(issueKey, summary);
      const secondVerification = await cache.getIssueSummary(issueKey);
      console.log(`[2/5] Retry verification: "${secondVerification}"`);
    } else {
      console.log(`[2/5] ✓ KVS stored and verified successfully`);
    }

    console.log(`[3/5] Fetching custom fields...`);
    const fieldsRes = await api.asApp().requestJira(route`/rest/api/3/field`);
    
    if (!fieldsRes.ok) {
      console.error(`[3/5] Failed to fetch fields: ${fieldsRes.status}`);
      return { success: true, kvsOnly: true };
    }
    
    const fields = await fieldsRes.json();
    const moduleKey = 'auto-assign-summary-field';
    const customField = fields.find(
      (f) => f?.schema?.custom && 
             typeof f.schema.custom === 'string' && 
             f.schema.custom.endsWith(`/static/${moduleKey}`)
    );

    if (!customField) {
      console.error('[4/5] Custom field not found - KVS stored but field not updated');
      return { success: true, kvsOnly: true };
    }

    console.log(`[4/5] Found custom field: ${customField.id}`);

    console.log(`[5/5] Updating field value...`);
    const updateBody = {
      updates: [
        {
          issueIds: [Number(issueId)],
          value: summary
        }
      ]
    };

    const updateRes = await api.asApp().requestJira(
      route`/rest/api/2/app/field/${customField.id}/value`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody)
      }
    );

    if (!updateRes.ok) {
      const errorText = await updateRes.text();
      console.error(`[5/5] Field update failed: ${updateRes.status} - ${errorText}`);
      return { success: true, kvsOnly: true };
    }

    console.log(`[SUCCESS] ✓ Both KVS and field updated for ${issueKey} (ID: ${issueId}): "${summary}"`);
    return { success: true, fullUpdate: true };
    
  } catch (error) {
    console.error(`[ERROR] Failed to update summary for ${issueKey}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * value function for the custom field: reads from KVS using issue ID
 */
export async function autoAssignSummaryValue(event) {
  console.log(`[autoAssignSummaryValue] Called for ${event.issues ? event.issues.length : 0} issues`);
  
  const results = await Promise.all(
    event.issues.map(async (issue) => {
      const issueId = issue.id;
      const issueKey = issue.key;
      
      if (!issueId) {
        console.error(`[autoAssignSummaryValue] No issue ID found in issue object`);
        return 'Not yet auto-assigned';
      }
      
      try {
        const summary = await cache.getIssueSummary(issueKey);
        console.log(`[autoAssignSummaryValue] Issue ID ${issueId}: "${summary || 'Not yet auto-assigned'}"`);
        return summary || 'Not yet auto-assigned';
      } catch (error) {
        console.error(`[autoAssignSummaryValue] Error for issue ID ${issueId}:`, error);
        return 'Not yet auto-assigned';
      }
    })
  );
  
  return results;
}

/**
 * sets initial value when issue is created
 */
export async function setAutoAssignOnCreate(event) {
  const issueId = event?.issue?.id;
  const issueKey = event?.issue?.key;
  
  console.log(`[setAutoAssignOnCreate] Called for ${issueKey} (ID: ${issueId})`);
  
  if (!issueId || !issueKey) {
    console.log('[setAutoAssignOnCreate] Missing issue ID or key');
    return;
  }

  const initialValue = 'Awaiting auto-assignment';

  await cache.cacheIssueSummary(issueKey, initialValue);
  console.log(`[setAutoAssignOnCreate] Stored in KVS: ${issueKey}`);

  try {
    const fieldsRes = await api.asApp().requestJira(route`/rest/api/3/field`);
    const fields = await fieldsRes.json();

    const moduleKey = 'auto-assign-summary-field';
    const target = fields.find(
      (f) => f?.schema?.custom && 
             typeof f.schema.custom === 'string' && 
             f.schema.custom.endsWith(`/static/${moduleKey}`)
    );

    if (!target) {
      console.log('[setAutoAssignOnCreate] Custom field not found yet');
      return;
    }

    const body = {
      updates: [
        {
          issueIds: [Number(issueId)],
          value: initialValue
        }
      ]
    };

    const res = await api.asApp().requestJira(
      route`/rest/api/2/app/field/${target.id}/value`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );

    console.log(`[setAutoAssignOnCreate] Field set: ${res.status} ${res.statusText}`);
  } catch (error) {
    console.error('[setAutoAssignOnCreate] Error:', error);
  }
}