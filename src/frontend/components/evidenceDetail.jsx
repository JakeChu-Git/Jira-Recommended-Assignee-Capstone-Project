import React, { useEffect, useState } from 'react';
import {
  Stack,
  Box,
  Text,
  Heading,
  Inline,
  Icon,
  Tag
} from '@forge/react';

const EvidenceDetail = ({ recommendation }) => {
  if (!recommendation?.assignee?.evidence) {
    return <Text>No detailed evidence available</Text>;
  }

  const { evidence, workload, profileSummary } = recommendation.assignee;

  return (
    <Stack space="space.300">
      {/* Metadata Matches */}
      {(evidence.labels.length > 0 || evidence.components.length > 0 ||
        evidence.issueTypes.length > 0 || evidence.epics.length > 0 ||
        evidence.parents.length > 0) && (
        <Box>
          <Inline space="space.100" alignBlock="center">
            <Heading size="small">Metadata Matches</Heading>
          </Inline>
          <Stack space="space.100">
            {evidence.labels.length > 0 && (
              <Box>
                <Text weight="bold">Labels ({evidence.labels.length} matches):</Text>
                {evidence.labels.map((item, idx) => (
                  <Inline key={idx} space="space.100" alignBlock="center">
                    <Tag text={item.label || item.labelId} />
                    <Text>
                      {item.count} previous issue(s)
                      (score: +{item.contribution.toFixed(2)})
                    </Text>
                  </Inline>
                ))}
              </Box>
            )}

            {evidence.components.length > 0 && (
              <Box>
                <Text weight="bold">Components ({evidence.components.length} matches):</Text>
                {evidence.components.map((item, idx) => (
                  <Inline key={idx} space="space.100" alignBlock="center">
                    <Icon glyph="component" />
                    <Text>
                      {item.component} - {item.count} previous issue(s)
                      (score: +{item.contribution.toFixed(2)})
                    </Text>
                  </Inline>
                ))}
              </Box>
            )}

            {evidence.issueTypes.length > 0 && (
              <Box>
                <Text weight="bold">Issue Types ({evidence.issueTypes.length} matches):</Text>
                {evidence.issueTypes.map((item, idx) => (
                  <Inline key={idx} space="space.100" alignBlock="center">
                    <Icon glyph="tasks" color='color.background.accent.blue.subtle' />
                    <Text>
                      {item.issueType} - {item.count} previous issue(s)
                      (score: +{item.contribution.toFixed(2)})
                    </Text>
                  </Inline>
                ))}
              </Box>
            )}

            {evidence.epics.length > 0 && (
              <Box>
                <Text weight="bold">Epic Experience ({evidence.epics.length} matches):</Text>
                {evidence.epics.map((item, idx) => (
                  <Inline key={idx} space="space.100" alignBlock="center">
                    <Icon glyph="epic" color="color.icon.accent.purple" />
                    <Text>
                      {item.epicKey} - {item.count} previous issue(s)
                      (score: +{item.contribution.toFixed(2)})
                    </Text>
                  </Inline>
                ))}
              </Box>
            )}

            {evidence.parents.length > 0 && (
              <Box>
                <Text weight="bold">Parent Issue Work ({evidence.parents.length} matches):</Text>
                {evidence.parents.map((item, idx) => (
                  <Inline key={idx} space="space.100" alignBlock="center">
                    <Icon glyph="department" />
                    <Text>
                      {item.parentKey} - {item.count} previous issue(s)
                      (score: +{item.contribution.toFixed(2)})
                    </Text>
                  </Inline>
                ))}
              </Box>
            )}
          </Stack>
        </Box>
      )}

      {/* Historical Interactions */}
      {evidence.interactions.length > 0 && (
        <Box>
          <Inline space="space.100" alignBlock="center">
            <Icon glyph="history" />
            <Heading size="small">Historical Interactions</Heading>
          </Inline>
          <Stack space="space.100">
            {evidence.interactions.map((interaction, idx) => {
              if (interaction.type === 'historical-assignee') {
                return (
                  <Inline key={idx} space="space.100" alignBlock="center">
                    <Icon glyph="person" />
                    <Text>
                      Previously assigned similar issues: {interaction.count} time(s)
                      (score: +{interaction.contribution.toFixed(2)})
                    </Text>
                  </Inline>
                );
              } else if (interaction.type === 'worklog') {
                return (
                  <Inline key={idx} space="space.100" alignBlock="center">
                    <Icon glyph="backlog" />
                    <Text>
                      Logged {interaction.hours.toFixed(1)} hours on similar issues
                      (score: +{interaction.contribution.toFixed(2)})
                    </Text>
                  </Inline>
                );
              } else if (interaction.type === 'comment') {
                return (
                  <Inline key={idx} space="space.100" alignBlock="center">
                    <Icon glyph="comment" />
                    <Text>
                      Commented on {interaction.count} similar issue(s)
                      (score: +{interaction.contribution.toFixed(2)})
                    </Text>
                  </Inline>
                );
              } else if (interaction.type === 'assigned-issue-count') {
                return (
                  <Inline key={idx} space="space.100" alignBlock="center">
                    <Icon glyph="task" color='color.background.accent.blue.subtle'/>
                    <Text>
                      Total issues assigned: {interaction.count}
                      (score: +{interaction.contribution.toFixed(2)})
                    </Text>
                  </Inline>
                );
              } else if (interaction.type === 'worklog-issue-count') {
                return (
                  <Inline key={idx} space="space.100" alignBlock="center">
                    <Text>
                      Total issues with worklogs: {interaction.count}
                      (score: +{interaction.contribution.toFixed(2)})
                    </Text>
                  </Inline>
                );
              } else if (interaction.type === 'comment-issue-count') {
                return (
                  <Inline key={idx} space="space.100" alignBlock="center">
                    <Icon glyph="comment" />
                    <Text>
                      Total issues commented on: {interaction.count}
                      (score: +{interaction.contribution.toFixed(2)})
                    </Text>
                  </Inline>
                );
              }
              return null;
            })}
          </Stack>
        </Box>
      )}

      {/* Workload Information */}
      {workload && (
        <Box>
          <Inline space="space.100" alignBlock="center">
            <Heading size="small">Current Workload</Heading>
          </Inline>
          <Stack space="space.100">
            <Inline space="space.100" alignBlock="center">
              <Icon glyph="issues" />
              <Text>Open issues: {workload.totalIssues || 0}</Text>
            </Inline>
            <Inline space="space.100" alignBlock="center">
              <Icon glyph="time" />
              <Text>
                Estimated hours: {((workload.totalEstimateSeconds || 0) / 3600).toFixed(1)} hours
              </Text>
            </Inline>
            {evidence.penalties?.workload > 0 && (
              <Inline space="space.100" alignBlock="center">
                <Icon glyph="warning" />
                <Text>
                  Workload penalty: -{evidence.penalties.workload.toFixed(2)}
                </Text>
              </Inline>
            )}
          </Stack>
        </Box>
      )}

      {/* Score Summary */}
      <Box>
        <Inline space="space.100" alignBlock="center">
          <Icon glyph="calculator" />
          <Heading size="small">Score Calculation Breakdown</Heading>
        </Inline>
        <Stack space="space.100">
          <Text weight="bold">All Contributions:</Text>

          {/* Labels */}
          {evidence.labels && evidence.labels.length > 0 && evidence.labels.map((item, idx) => (
            <Text key={`label-${idx}`}>
              + {item.contribution.toFixed(2)} — Label "{item.label || item.labelId}" ({item.count} matches)
            </Text>
          ))}

          {/* Components */}
          {evidence.components && evidence.components.length > 0 && evidence.components.map((item, idx) => (
            <Text key={`component-${idx}`}>
              + {item.contribution.toFixed(2)} — Component "{item.component}" ({item.count} matches)
            </Text>
          ))}

          {/* Issue Types */}
          {evidence.issueTypes && evidence.issueTypes.length > 0 && evidence.issueTypes.map((item, idx) => (
            <Text key={`type-${idx}`}>
              + {item.contribution.toFixed(2)} — Issue Type "{item.issueType}" ({item.count} matches)
            </Text>
          ))}

          {/* Epics */}
          {evidence.epics && evidence.epics.length > 0 && evidence.epics.map((item, idx) => (
            <Text key={`epic-${idx}`}>
              + {item.contribution.toFixed(2)} — Epic "{item.epicKey}" ({item.count} matches)
            </Text>
          ))}

          {/* Parents */}
          {evidence.parents && evidence.parents.length > 0 && evidence.parents.map((item, idx) => (
            <Text key={`parent-${idx}`}>
              + {item.contribution.toFixed(2)} — Parent Issue "{item.parentKey}" ({item.count} matches)
            </Text>
          ))}

          {/* All Interactions */}
          {evidence.interactions && evidence.interactions.length > 0 && evidence.interactions.map((item, idx) => {
            let description = '';

            if (item.type === 'historical-assignee') {
              description = `Previously assigned similar issues (${item.count} times)`;
            } else if (item.type === 'worklog') {
              description = `Worklogs on similar issues (${item.hours ? item.hours.toFixed(1) : 0} hours)`;
            } else if (item.type === 'comment') {
              description = `Comments on similar issues (${item.count} comments)`;
            } else if (item.type === 'assigned-issue-count' || item.type === 'assignment-issue-count') {
              description = `Overall assignment history (${item.count} total issues)`;
            } else if (item.type === 'worklog-issue-count') {
              description = `Overall worklog history (${item.count} total issues)`;
            } else if (item.type === 'comment-issue-count') {
              description = `Overall comment history (${item.count} total issues)`;
            } else {
              description = `${item.type} (${item.count || 'N/A'})`;
            }

            return (
              <Text key={`interaction-${idx}`}>
                + {item.contribution.toFixed(2)} — {description}
              </Text>
            );
          })}

          <Text></Text>
          <Text weight="bold">
            = Raw Score: {recommendation.assignee.rawScore?.toFixed(2) || 'N/A'}
          </Text>

          <Text></Text>
          <Text weight="bold">Penalties:</Text>
          {(() => {
            const penalty = recommendation.assignee.workloadPenalty || 0;
            if (penalty > 0 && workload) {
              return (
                <Text>
                  - {penalty.toFixed(2)} — Workload penalty ({workload.totalIssues || 0} open issues, {((workload.totalEstimateSeconds || 0) / 3600).toFixed(1)} hours)
                </Text>
              );
            } else {
              return <Text>- 0.00 — No workload penalty</Text>;
            }
          })()}

          <Text></Text>
          <Text weight="bold">
            = Final Score: {recommendation.assignee.rawScore?.toFixed(2) || 0} - {recommendation.assignee.workloadPenalty?.toFixed(2) || 0} = {recommendation.assignee.finalScore?.toFixed(2) || 'N/A'}
          </Text>
          <Text size="small">(Raw Score - Workload Penalty = Final Score)</Text>
        </Stack>
      </Box>

      {/* Profile Summary */}
      {profileSummary && (
        <Box>
          <Inline space="space.100" alignBlock="center">
            <Icon glyph="person" />
            <Heading size="small">Profile Summary</Heading>
          </Inline>
          <Stack space="space.100">
            <Text>• Total assigned issues: {profileSummary.totalAssignedIssues || 0}</Text>
            <Text>• Total worklog issues: {profileSummary.totalWorklogIssues || 0}</Text>
            <Text>• Total commented issues: {profileSummary.totalCommentIssues || 0}</Text>
            {profileSummary.examples && profileSummary.examples.length > 0 && (
              <Box>
                <Text weight="bold">Recent work examples:</Text>
                {profileSummary.examples.map((example, idx) => (
                  <Text key={idx}>
                    • {example.key}: {example.summary}
                  </Text>
                ))}
              </Box>
            )}
          </Stack>
        </Box>
      )}
    </Stack>
  );
};

export default EvidenceDetail;