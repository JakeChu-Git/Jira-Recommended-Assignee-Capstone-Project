import { kvs } from '@forge/kvs';
import * as scrapeOrchestrator from './scrapers/scrapeOrchestrator.js';

// ===============
// CACHING FUNCTIONS
// ===============

/**
 * Caches the given issue data, keyed by the issue key.
 * 
 * @param {Object} issueData - issue data to cache
 */
export const cacheIssue = async (issueData) => {
    const issueCache = await kvs.get('issues');
    issueCache[issueData.key] = issueData;
    await kvs.set('issues', issueCache);

    console.log(`cache.js - issue ${issueData.key} cached`)
}

/**
 * Caches the given user profile, keyed by their account ID.
 * 
 * @param {Object} userProfile - user data to cache
 */
export const cacheUserProfile = async (userProfile) => {
    const userCache = await kvs.get('users');
    userCache[userProfile.accountId] = userProfile;
    await kvs.set('users', userCache);

    console.log(`cache.js - user ${userProfile.displayName} cached`)
}

/**
 * Updates user cache with a replacement set of user data.
 * 
 * @param {Object} userProfiles - replacement set of user data
 */
export const updateAllUserProfiles = async (userProfiles) => {
    await kvs.set('users', userProfiles);
}

/**
 * Caches the summary of the assignment reason for the issue
 * corresponding to the provided key.
 * 
 * @param {String} issueKey - issue key
 * @param {String} summary - summary of the assignment reason
 */
export const cacheIssueSummary = async (issueKey, summary) => {
    const summaryCache = await kvs.get('summaries');
    summaryCache[issueKey] = summary;
    await kvs.set('summaries', summaryCache);

    console.log(`cache.js - summary for issue ${issueKey} cached`);
}

/**
 * Caches the assignment state of the issue corresponding to the provided key.
 * 
 * @param {String} issueKey - issue key
 * @param {Object} stateObject - an object representing the assignment state
 */
export const cacheIssueAssignmentState = async (issueKey, stateObject) => {
    const assginmentStateCache = await kvs.get('assignmentStates');
    assginmentStateCache[issueKey] = stateObject;
    await kvs.set('assignmentStates', assginmentStateCache);

    console.log(`cache.js - assignment state for issue ${issueKey} cached`);
}

/**
 * Caches the workload of the account corresponding to the provided ID.
 * 
 * @param {String} accountId - the ID of the account
 * @param {Object} workload - an object representing their workload
 */
export const cacheWorkload = async (accountId, workload) => {
    const workloadCache = await kvs.get('workloads');
    workloadCache[accountId] = workload;
    await kvs.set('workloads', workloadCache);

    console.log(`cache.js - workload for user ${accountId} cached`)
}

// ===================
// RETRIEVAL FUNCTIONS
// ===================

/**
 * Returns all issues from the cache.
 * 
 * @returns {Promise<Object>} - all cached issues
 */
export const allIssues = async () => {
    console.log('cache.js - retrieving all issues');
    return await kvs.get('issues');
}

/**
 * Returns all user profiles from the cache.
 * 
 * @returns {Promise<Object>} - all cached users
 */
export const allUserProfiles = async () => {
    console.log('cache.js - retrieving all users');
    return await kvs.get('users');
}

/**
 * Returns the issue associated with the given issue key.
 * 
 * @param {string} issueKey - issue key
 * @returns {Promise<Object>} - associated issue data
 */
export const getIssue = async (issueKey) => {
    console.log(`cache.js - retrieving issue ${issueKey}`);

    const issueCache = await kvs.get('issues');
    if (!issueCache) return null;
    return issueCache[issueKey];
}

/**
 * Returns the user profile associated with the given account ID.
 * 
 * @param {String} accountID - account ID 
 * @returns {Promise<Object>} - associated user profile
 */
export const getUserProfile = async (accountId) => {
    const userCache = await kvs.get('users');
    if (!userCache) return null;
    return userCache[accountId];
}

/**
 * Returns the assignment summary of the issue associated with the provided
 * issue key.
 * 
 * @param {String} issueKey - the issue key
 * @returns {Promise<Object>} - associated assignment summary
 */
export const getIssueSummary = async (issueKey) => {
    console.log(`cache.js - retrieving summary for issue ${issueKey}`);

    const summaryCache = await kvs.get('summaries');
    if (!summaryCache) return null;
    return summaryCache[issueKey];
}

/**
 * Returns the assignment state of the issue associated with the provided
 * issue key.
 * 
 * @param {String} issueKey - the issue key
 * @returns {Promise<Object>} - associated assignment state
 */
export const getIssueAssignmentState = async (issueKey) => {
    console.log(`cache.js - retrieving assignment state for issue ${issueKey}`);

    const assginmentStateCache = await kvs.get('assignmentStates');
    if (!assginmentStateCache) return null;
    return assginmentStateCache[issueKey];
}

/**
 * Returns the workload associated with the account with the provided ID.
 * 
 * @param {String} accountId 
 * @returns {Promise<Object>} - associated workload
 */
export const getWorkload = async (accountId) => {
    console.log(`cache.js - retrieving workload for user ${accountId}`);

    const workloadCache = await kvs.get('workloads');
    if (!workloadCache) {
        console.warn(`cache.js - workloads cache not initialized`);
        return null;
    }
    return workloadCache[accountId];
}

// ===================
// OPERATION FUNCTIONS
// ===================

/**
 * Checks if a cache already exists.
 * If not, creates the cache and generates data from a full project scrape.
 * 
 * @param {String} projectKey - Jira project key the app is running on
 */
export const initialiseCache = async (projectKey) => {
    const issueCache = await kvs.get('issues');
    const usersCache = await kvs.get('users');
    const summariesCache = await kvs.get('summaries');
    const assignmentStatesCache = await kvs.get('assignmentStates');
    const workloadsCache = await kvs.get('workloads');

    if ([issueCache, usersCache, summariesCache, assignmentStatesCache, workloadsCache].some(
            (cache) => cache === undefined)) {
        await kvs.set('users', {});
        await kvs.set('issues', {});
        await kvs.set('summaries', {});
        await kvs.set('assignmentStates', {});
        await kvs.set('workloads', {});

        await scrapeOrchestrator.scrapeFullProject(projectKey, {});

        console.log('cache.js - cache initialised.')
    }

    else {
        console.log('cache.js - cache already initialised.')
    }
}

// =================
// REMOVAL FUNCTIONS
// =================

/**
 * Removes an issue from the cache.
 * 
 * @param {String} issueKey - issue key
 */
export const uncacheIssue = async (issueKey) => {
    const issueCache = await kvs.get('issues');
    const summaryCache = await kvs.get('summaries');
    const assignmentStateCache = await kvs.get('assignmentStates');

    delete issueCache[issueKey];
    delete summaryCache[issueKey];
    delete assignmentStateCache[issueKey];

    console.log(`cache.js - issue ${issueKey} deleted from cache.`);
}

/**
 * Removes all stored data from the cache.
 */
export const resetCache = async () => {
    await kvs.delete('issues');
    await kvs.delete('users');
    await kvs.delete('summaries');
    await kvs.delete('assignmentStates');
    await kvs.delete('workloads');

    console.log('cache.js - cache reset.');
}

/**
 * Removes the assignment state of the issue associated with the provided
 * issue key from the cache.
 * 
 * @param {String} issueKey - the issue key
 */
export const uncacheIssueAssignmentState = async (issueKey) => {
    const assignmentStateCache = await kvs.get('assignmentStates');
    delete assignmentStateCache[issueKey];

    console.log(`cache.js - assignment state for ${issueKey} deleted from cache.`);
}

// ======================
// EVENT DRIVEN FUNCTIONS
// ======================

/**
 * Scrapes an issue that has been changed and thus caches it.
 * 
 * @param {Object} event - the event payload
 */
export const cacheIssueChange = async (event) => {
    const eventType = event.eventType;
    const issueKey = event.issue.key;

    console.log(`cache.js - caching change in issue ${issueKey}, event type ${eventType}`);

    switch (eventType) {
        case 'avi:jira:deleted:issue':
            uncacheIssue(issueKey);
            break;
        default:
            scrapeOrchestrator.scrapeSingleIssue(issueKey);
    }
}