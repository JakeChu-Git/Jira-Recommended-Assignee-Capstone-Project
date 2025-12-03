import api, { route } from '@forge/api';

// Check if issue is assigned
export async function checkIssueAssignee (key) {
  const issueKey = key.payload.issueKey;
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`)
  const data = await res.json();
  if (data?.fields?.assignee !== null) {
    return true;
  } else {
    return false;
  }
}

// Posts comment and creates notification
export async function postComment (issueKey, message) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                text: message,
                type: "text"
              }
            ]
          }
        ]
      }
    }),
  });

  return res.json();
}

// Notify users once issue is assigned
export async function notifyOnAssignment (event) {
  const { changelog, issue } = event;
  const changedFields = changelog?.items || [];

  if (changedFields[0].to !== null) {
    await postComment(issue.key, "This issue has been assigned.");
  }
}

