import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';
import {
  Stack,
  Box,
  Text,
  Inline,
  Toggle,
  Button,
  ButtonGroup,
  Spinner,
  SectionMessage,
  Heading,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  Checkbox,
  Icon,
  Tag,
  Link,
  useProductContext,
  SectionMessageAction
} from '@forge/react';

const AdminPanel = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [epics, setEpics] = useState([]);
  const [labels, setLabels] = useState([]);
  const [unassignedTasks, setUnassignedTasks] = useState([]);
  const [selectedEpics, setSelectedEpics] = useState({});
  const [selectedLabels, setSelectedLabels] = useState({});
  const [selectedTasks, setSelectedTasks] = useState({});
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState(null);
  const [assignmentDetails, setAssignmentDetails] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const context = useProductContext();

  // Criteria toggles
  const [criteria, setCriteria] = useState({
    // Metadata Matches
    labels: true,
    components: true,
    issueType: true,
    epic: true,
    parent: true,
    // Direct Historical Interactions
    previousAssignee: true,
    worklogs: true,
    comments: true,
    // General Track Record
    overallAssignments: true,
    overallWorklogs: true,
    overallComments: true,
    // Workload
    workloadOpenIssues: true,
    workloadEstimateHours: true
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch epics
      const epicsResponse = await invoke('getEpics');
      if (epicsResponse.success) {
        setEpics(epicsResponse.epics);
        const initialEpicState = {};
        epicsResponse.epics.forEach(epic => {
          initialEpicState[epic.key] = false;
        });
        setSelectedEpics(initialEpicState);
      } else {
        setMessage({ type: 'error', text: `Error loading epics: ${epicsResponse.error}` });
      }

      // Fetch labels
      const labelsResponse = await invoke('getLabels');
      if (labelsResponse.success) {
        setLabels(labelsResponse.labels);
        const initialLabelState = {};
        labelsResponse.labels.forEach(label => {
          initialLabelState[label] = false;
        });
        setSelectedLabels(initialLabelState);
      } else {
        setMessage({ type: 'error', text: `Error loading labels: ${labelsResponse.error}` });
      }

      // Fetch unassigned tasks
      const tasksResponse = await invoke('getUnassignedTasks');
      if (tasksResponse.success) {
        setUnassignedTasks(tasksResponse.tasks);
        const initialTaskState = {};
        tasksResponse.tasks.forEach(task => {
          initialTaskState[task.key] = false;
        });
        setSelectedTasks(initialTaskState);
      } else {
        setMessage({ type: 'error', text: `Error loading tasks: ${tasksResponse.error}` });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Failed to load data: ${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleEpicToggle = (epicKey, isChecked) => {
    setSelectedEpics(prev => ({ ...prev, [epicKey]: isChecked }));
  };

  const handleLabelToggle = (label, isChecked) => {
    setSelectedLabels(prev => ({ ...prev, [label]: isChecked }));
  };

  const handleTaskToggle = (taskKey, isChecked) => {
    setSelectedTasks(prev => ({ ...prev, [taskKey]: isChecked }));
  };

  const handleCriteriaToggle = (criteriaKey, isChecked) => {
    setCriteria(prev => ({ ...prev, [criteriaKey]: isChecked }));
  };

  const handleSubmit = async () => {
    let selectedKeys;
    let mode;

    if (activeTab === 0) {
      selectedKeys = Object.keys(selectedEpics).filter(key => selectedEpics[key]);
      mode = 'epic';
    } else if (activeTab === 1) {
      selectedKeys = Object.keys(selectedLabels).filter(key => selectedLabels[key]);
      mode = 'label';
    } else {
      selectedKeys = Object.keys(selectedTasks).filter(key => selectedTasks[key]);
      mode = 'task';
    }

    if (selectedKeys.length === 0) {
      setMessage({ type: 'warning', text: `Please select at least one ${mode} to auto-assign.` });
      return;
    }

    const enabledCriteria = Object.values(criteria).some(val => val);
    if (!enabledCriteria) {
      setMessage({ type: 'warning', text: 'Please enable at least one assignment criteria.' });
      return;
    }

    setProcessing(true);
    setMessage(null);
    setAssignmentDetails(null);
    setShowDetails(false);
    try {
      const response = await invoke('autoAssignByMode', { mode: mode, keys: selectedKeys, criteria: criteria });

      if (response.success) {
        setMessage({
          type: 'success',
          text: `Successfully processed ${response.totalProcessed} issue(s) across ${selectedKeys.length} ${mode}(s).
           Assigned: ${response.totalAssigned}, Skipped: ${response.totalSkipped}.`
        });

        setAssignmentDetails({
          assigned: response.assignedIssues || [],
          skipped: response.skippedIssues || [],
          failed: response.failedIssues || []
        });
        setShowDetails(false);

        // Reset toggles for selected items
        if (activeTab === 0) {
          const resetState = { ...selectedEpics };
          selectedKeys.forEach(key => {
            resetState[key] = false;
          });
          setSelectedEpics(resetState);
        } else if (activeTab === 1) {
          const resetState = { ...selectedLabels };
          selectedKeys.forEach(key => {
            resetState[key] = false;
          });
          setSelectedLabels(resetState);
        } else {
          const resetState = { ...selectedTasks };
          selectedKeys.forEach(key => {
            resetState[key] = false;
          });
          setSelectedTasks(resetState);

          // Refresh the task list after assignment
          const tasksResponse = await invoke('getUnassignedTasks');
          if (tasksResponse.success) {
            setUnassignedTasks(tasksResponse.tasks);
            const newTaskState = {};
            tasksResponse.tasks.forEach(task => {
              newTaskState[task.key] = false;
            });
            setSelectedTasks(newTaskState);
          }
        }
      } else {
        setMessage({ type: 'error', text: `Error: ${response.error}` });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Failed to assign issues: ${error.message}` });
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = () => {
    if (activeTab === 0) {
      const resetState = {};
      epics.forEach(epic => {
        resetState[epic.key] = false;
      });
      setSelectedEpics(resetState);
    } else if (activeTab === 1) {
      const resetState = {};
      labels.forEach(label => {
        resetState[label] = false;
      });
      setSelectedLabels(resetState);
    } else {
      const resetState = {};
      unassignedTasks.forEach(task => {
        resetState[task.key] = false;
      });
      setSelectedTasks(resetState);
    }
    setMessage(null);
    setAssignmentDetails(null);
    setShowDetails(false);
  };

  const handleSelectAllTasks = () => {
    const allSelected = {};
    unassignedTasks.forEach(task => {
      allSelected[task.key] = true;
    });
    setSelectedTasks(allSelected);
  };

  const handleResetCriteria = () => {
    const allEnabled = {};
    Object.keys(criteria).forEach(key => {
      allEnabled[key] = true;
    });
    setCriteria(allEnabled);
  };

  if (loading) {
    return (
      <Box padding="space.300">
        <Inline alignBlock='center' alignInline='center'>
          <Spinner size="large" label="Loading..." />
        </Inline>
      </Box>
    );
  }

  return (
    <Stack space="space.400">
      {message && (
        <Stack space="space.200">
          <SectionMessage
            appearance={message.type}
            actions={[
              <SectionMessageAction
                onClick={() => setShowDetails(!showDetails)}>
                {showDetails ? 'Hide Details' : 'See Details'}
              </SectionMessageAction>
            ]}>
            <Text>{message.text}</Text>
              {/* Assignment Details Section */}
              {assignmentDetails && message.type === 'success' && (
                <Box>
                  {showDetails && (
                    <Box
                      xcss={{
                        maxHeight: '250px',
                        overflowY: 'auto',
                        marginTop: 'space.100'
                      }}
                    >
                      <Stack space="space.300">
                        {/* Successfully Assigned */}
                        {assignmentDetails.assigned.length > 0 && (
                          <Box>
                            <Inline space="space.100">
                              <Heading size="xsmall">Successfully Assigned ({assignmentDetails.assigned.length})</Heading>
                            </Inline>
                            <Box xcss={{ paddingLeft: 'space.100' }}>
                              <Stack space="space.100">
                                {assignmentDetails.assigned.map((issue, idx) => (
                                  <Inline key={idx} space="space.100">
                                    <Text>•</Text>
                                    <Link
                                      href={`${context.siteUrl}/browse/${issue.key}`}
                                      openNewTab={true}
                                    >
                                      {issue.key} - {issue.summary}
                                    </Link>
                                    <Box> → {issue.assignee}</Box>
                                  </Inline>
                                ))}
                              </Stack>
                            </Box>
                          </Box>
                        )}

                        {/* Skipped Issues */}
                        {assignmentDetails.skipped.length > 0 && (
                          <Box>
                            <Inline space="space.100">
                              <Heading size="xsmall">Skipped ({assignmentDetails.skipped.length})</Heading>
                            </Inline>
                            <Stack space="space.100">
                              {assignmentDetails.skipped.map((issue, idx) => (
                                <Inline key={idx} space="space.100">
                                  <Text>•</Text>
                                  <Link
                                    href={`${context.siteUrl}/browse/${issue.key}`}
                                    openNewTab={true}
                                  >
                                    {issue.key} - {issue.summary}
                                  </Link>
                                  <Text>- ({issue.reason})</Text>
                                </Inline>
                              ))}
                            </Stack>
                          </Box>
                        )}

                        {/* Failed Issues */}
                        {assignmentDetails.failed.length > 0 && (
                          <Box>
                            <Inline space="space.100">
                              <Heading size="xsmall">Failed ({assignmentDetails.failed.length})</Heading>
                            </Inline>
                            <Stack space="space.100">
                              {assignmentDetails.failed.map((issue, idx) => (
                                <Inline key={idx} space="space.100">
                                  <Text>•</Text>
                                  <Link
                                    href={`${context.siteUrl}/browse/${issue.key}`}
                                    openNewTab={true}
                                  >
                                    {issue.key} - {issue.summary}
                                  </Link>
                                  <Text>- ({issue.error})</Text>
                                </Inline>
                              ))}
                            </Stack>
                          </Box>
                        )}
                      </Stack>
                    </Box>
                  )}
                </Box>
              )}
          </SectionMessage>
        </Stack>
      )}

      <Tabs onChange={(index) => setActiveTab(index)} id="assignment-mode-tabs">
        <TabList>
          <Tab>Epics</Tab>
          <Tab>Labels</Tab>
          <Tab>All Tasks</Tab>
        </TabList>

        {/* Epic Tab */}
        <TabPanel>
            <Box padding='space.200'>
              {epics.length === 0 ? (
                <Text>No epics found in this project.</Text>
              ) : (
                <Stack space="space.200">
                  <Heading size="small">Select Epics</Heading>
                  {epics.map(epic => (
                    <Inline key={epic.key} space="space.100" alignBlock="center">
                      <Toggle
                        id={`toggle-epic-${epic.key}`}
                        isChecked={selectedEpics[epic.key] || false}
                        onChange={(e) => handleEpicToggle(epic.key, e.target.checked)}
                        isDisabled={processing}
                      />
                      {/* Note: This form of using icons will be deprecated on 22nd Dec.
                      This will work for the present. */}
                      <Icon glyph="epic" color="color.icon.accent.purple" />
                      <Text>{epic.key} - {epic.summary}</Text>
                    </Inline>
                  ))}
                </Stack>
              )}
            </Box>
        </TabPanel>

        {/* Label Tab */}
        <TabPanel>
            <Box padding='space.200'>
              {labels.length === 0 ? (
                <Text>No labels found in this project.</Text>
              ) : (
                <Stack space="space.200">
                  <Heading size="small">Select Labels</Heading>
                  {labels.map(label => (
                    <Inline key={label} space="space.100" alignBlock="center">
                      <Toggle
                        id={`toggle-label-${label}`}
                        isChecked={selectedLabels[label] || false}
                        onChange={(e) => handleLabelToggle(label, e.target.checked)}
                        isDisabled={processing}
                      />
                      <Tag text={`${label}`} />
                    </Inline>
                  ))}
                </Stack>
              )}
            </Box>
        </TabPanel>

        {/* All Tasks Tab */}
        <TabPanel>
          <Box padding='space.200' xcss={{ width: '100%' }}>
            {unassignedTasks.length === 0 ? (
              <Text>No unassigned tasks found in this project.</Text>
            ) : (
              <Stack space="space.200">
                <Inline space="space.150" alignBlock="center">
                  <Heading size="small">Select Tasks ({unassignedTasks.length} unassigned)</Heading>
                  <Button appearance="subtle" onClick={handleSelectAllTasks} isDisabled={processing}>
                    Select All
                  </Button>
                </Inline>
                <Box xcss={{ maxHeight: '400px', overflowY: 'auto' }}>
                  <Stack space="space.150">
                    {unassignedTasks.map(task => (
                      <Inline key={task.key} space="space.100" alignBlock="center">
                        <Toggle
                          id={`toggle-task-${task.key}`}
                          isChecked={selectedTasks[task.key] || false}
                          onChange={(e) => handleTaskToggle(task.key, e.target.checked)}
                          isDisabled={processing}
                        />
                        {task.issueType === 'Bug' && <Icon glyph="bug" color='color.background.accent.red.subtle'/>}
                        {task.issueType === 'Task' && <Icon glyph="task" color='color.background.accent.blue.subtle' />}
                        {task.issueType === 'Sub-task' && <Icon glyph="subtasks" color='color.background.accent.blue.subtle' />}
                        <Text>{task.key} - {task.summary}</Text>
                      </Inline>
                    ))}
                  </Stack>
                </Box>
              </Stack>
            )}
          </Box>
        </TabPanel>
      </Tabs>

      {/* Action Buttons */}
      <ButtonGroup label="Actions">
        <Button
          appearance="primary"
          onClick={handleSubmit}
          isDisabled={processing || (activeTab === 0 && epics.length === 0)}
        >
          {processing ? 'Processing...' : 'Auto-Assign Selected'}
        </Button>
        <Button
          onClick={handleReset}
          isDisabled={processing}
        >
          Reset Selection
        </Button>
      </ButtonGroup>

      {/* Criteria Selection */}
      <Box>
        <Inline space="space.200" alignBlock="center">
          <Heading size="small">Assignment Criteria</Heading>
          <Button appearance="subtle" onClick={handleResetCriteria} isDisabled={processing}>
            Enable All
          </Button>
        </Inline>

        <Stack space="space.300">
          <Box xcss={{ width: '59%' }}>
            <Inline spread='space-between'>
              {/* Metadata Matches */}
              <Box>
                <Text weight="bold">Metadata Matches</Text>
                <Stack space="space.100">
                  <Checkbox
                    name="criteria-labels"
                    label="Labels (weight: 3.2)"
                    isChecked={criteria.labels}
                    onChange={(e) => handleCriteriaToggle('labels', e.target.checked)}
                    isDisabled={processing}
                  />
                  <Checkbox
                    name="criteria-components"
                    label="Components (weight: 2.4)"
                    isChecked={criteria.components}
                    onChange={(e) => handleCriteriaToggle('components', e.target.checked)}
                    isDisabled={processing}
                  />
                  <Checkbox
                    name="criteria-issueType"
                    label="Issue Type (weight: 2.8)"
                    isChecked={criteria.issueType}
                    onChange={(e) => handleCriteriaToggle('issueType', e.target.checked)}
                    isDisabled={processing}
                  />
                  <Checkbox
                    name="criteria-epic"
                    label="Epic (weight: 1.4)"
                    isChecked={criteria.epic}
                    onChange={(e) => handleCriteriaToggle('epic', e.target.checked)}
                    isDisabled={processing}
                  />
                  <Checkbox
                    name="criteria-parent"
                    label="Parent Issue (weight: 1.6)"
                    isChecked={criteria.parent}
                    onChange={(e) => handleCriteriaToggle('parent', e.target.checked)}
                    isDisabled={processing}
                  />
                </Stack>
              </Box>

              {/* Direct Historical Interactions */}
              <Box>
                <Text weight="bold">Direct Historical Interactions</Text>
                <Stack space="space.100">
                  <Checkbox
                    name="criteria-previousAssignee"
                    label="Previous Assignee (weight: 5.0)"
                    isChecked={criteria.previousAssignee}
                    onChange={(e) => handleCriteriaToggle('previousAssignee', e.target.checked)}
                    isDisabled={processing}
                  />
                  <Checkbox
                    name="criteria-worklogs"
                    label="Worklogs (weight: 2.5)"
                    isChecked={criteria.worklogs}
                    onChange={(e) => handleCriteriaToggle('worklogs', e.target.checked)}
                    isDisabled={processing}
                  />
                  <Checkbox
                    name="criteria-comments"
                    label="Comments (weight: 1.2)"
                    isChecked={criteria.comments}
                    onChange={(e) => handleCriteriaToggle('comments', e.target.checked)}
                    isDisabled={processing}
                  />
                </Stack>
              </Box>
            </Inline>
          </Box>

          <Box xcss={{ width: '61%' }}>
            <Inline spread='space-between'>
              {/* General Track Record */}
              <Box>
                <Text weight="bold">General Track Record</Text>
                <Stack space="space.100">
                  <Checkbox
                    name="criteria-overallAssignments"
                    label="Overall Assignments (weight: 0.9)"
                    isChecked={criteria.overallAssignments}
                    onChange={(e) => handleCriteriaToggle('overallAssignments', e.target.checked)}
                    isDisabled={processing}
                  />
                  <Checkbox
                    name="criteria-overallWorklogs"
                    label="Overall Worklogs (weight: 0.7)"
                    isChecked={criteria.overallWorklogs}
                    onChange={(e) => handleCriteriaToggle('overallWorklogs', e.target.checked)}
                    isDisabled={processing}
                  />
                  <Checkbox
                    name="criteria-overallComments"
                    label="Overall Comments (weight: 0.5)"
                    isChecked={criteria.overallComments}
                    onChange={(e) => handleCriteriaToggle('overallComments', e.target.checked)}
                    isDisabled={processing}
                  />
                </Stack>
              </Box>

              {/* Workload Considerations */}
              <Box>
                <Text weight="bold">Workload Considerations</Text>
                <Stack space="space.100">
                  <Checkbox
                    name="criteria-workloadOpenIssues"
                    label="Open Issues Count (weight: 0.85)"
                    isChecked={criteria.workloadOpenIssues}
                    onChange={(e) => handleCriteriaToggle('workloadOpenIssues', e.target.checked)}
                    isDisabled={processing}
                  />
                  <Checkbox
                    name="criteria-workloadEstimateHours"
                    label="Estimate Hours (weight: 0.12)"
                    isChecked={criteria.workloadEstimateHours}
                    onChange={(e) => handleCriteriaToggle('workloadEstimateHours', e.target.checked)}
                    isDisabled={processing}
                  />
                </Stack>
              </Box>
            </Inline>
          </Box>
        </Stack>
      </Box>
    </Stack>
  );
};

export default AdminPanel;