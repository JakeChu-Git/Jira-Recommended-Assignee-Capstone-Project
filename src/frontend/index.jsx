import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Text,
  Button,
  useProductContext,
  Inline,
  Modal,
  ModalTransition,
  ModalHeader,
  ModalTitle,
  ModalBody,
  Stack,
  Heading,
  Box,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { view } from '@forge/bridge';
import EvidenceDetail from './components/evidenceDetail';

const App = () => {
  const [cacheInitialised, setCacheInitialised] = useState(false);
  const [recommendation, setRecommendation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [actualAssignee, setActualAssignee] = useState(null);
  const context = useProductContext();
  const issueKey = context?.extension.issue.key;

  useEffect(() => {
    initialize();
  }, [issueKey]);

  const initialize = async () => {
    if (!issueKey) return;

    // Initialize cache first
    const cacheInit = await invoke('initialiseCache');
    setCacheInitialised(cacheInit);

    try {
      const [userResponse, assigneeResponse] = await Promise.all([
        invoke('getCurrentUser'),
        invoke('getIssueAssignee', { issueKey })
      ]);

      if (userResponse.success) {
        setCurrentUser(userResponse.user);
      }

      if (assigneeResponse.success) {
        setActualAssignee(assigneeResponse.assignee);
      }
    } catch (err) {
      console.error('Error fetching user/assignee:', err);
    }

    // Load recommendation after cache ready
    if (cacheInit) {
      loadRecommendation();
    }
  };

  const loadRecommendation = async () => {
    setLoading(true);
    setError(null);
    try {
      // Get recommendation without assigning (preview mode)
      const response = await invoke('autoAssignIssue', {
        preview: true
      });

      if (response.success && response.result) {
        // Check if the issue is actually assigned to the recommended person
        const assigneeResponse = await invoke('getIssueAssignee', { issueKey });

        let adjustedStatus = response.result.status;
        if (assigneeResponse.success && assigneeResponse.assignee) {
          const actualAssignee = assigneeResponse.assignee;
          const recommendedAssignee = response.result.assignee;

          // If the actual assignee matches the recommended assignee, then treat it as assigned
          if (actualAssignee.accountId === recommendedAssignee?.accountId) {
            adjustedStatus = 'assigned';
          }
        }

        setRecommendation({ ...response.result, status: adjustedStatus });
      } else {
        setError(response.error || 'Failed to load recommendation');
      }
    } catch (err) {
      console.error('Error loading recommendation:', err);
      setError('Error loading recommendation');
    } finally {
      setLoading(false);
    }
  };

  const handleAutoAssign = async () => {
    setLoading(true);
    try {
      const response = await invoke('autoAssignIssue', {
        preview: false
      });

      if (response.success && response.result) {
        alert(`Successfully assigned to ${response.result.assignee.displayName}`);
        // render status as assigned, allows the decline button to appear
        setRecommendation({
          ...response.result,
          status: 'assigned',
        });
        
        // Refresh the actual assignee
        const assigneeResponse = await invoke('getIssueAssignee', { issueKey });
        if (assigneeResponse.success) {
          setActualAssignee(assigneeResponse.assignee);
        }
      } else {
        alert(`Assignment failed: ${response.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error during assignment:', err);
      alert('Error during assignment');
    } finally {
      setLoading(false);
    }
  };

  const handleDecline = async () => {
    if (!recommendation?.assignee?.accountId) return;
    
    setLoading(true);
    try {
      const response = await invoke('declineAssignment', {
        accountId: recommendation.assignee.accountId,
        preview: false
      });

      if (response.success && response.result) {
        if (response.result.assignee) {
          // Show the new recommendation (not assigned yet)
          setRecommendation(response.result);
          alert(`Declined. New recommendation: ${response.result.assignee.displayName}`);
        } else {
          // No more candidates available
          setRecommendation(response.result);
          alert(response.result.message || 'No more suitable candidates available');
        }
        
        // Refresh the actual assignee (should be null after decline)
        const assigneeResponse = await invoke('getIssueAssignee', { issueKey });
        if (assigneeResponse.success) {
          setActualAssignee(assigneeResponse.assignee);
        }
      } else {
        alert(`Decline failed: ${response.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error during decline:', err);
      alert('Error during decline');
    } finally {
      setLoading(false);
    }
  };

  // Render detailed evidence breakdown
  const renderDetailedEvidence = () => {
    if (!recommendation?.assignee?.evidence) {
      return <Text>No detailed evidence available</Text>;
    }

    return (
      <EvidenceDetail recommendation={recommendation} />
    );
  };

  if (loading) {
    return <Text>Loading recommendation...</Text>;
  }

  if (error) {
    return (
      <>
        <Text>Error: {error}</Text>
        <Button onClick={loadRecommendation}>Retry</Button>
      </>
    );
  }

  if (!recommendation) {
    return <Text>No recommendation available</Text>;
  }

  const { assignee, status, alternatives = [] } = recommendation;
  const isAssigned = status === 'assigned';
  const canAssign = status === 'recommendation-only' && assignee;
  
  // Only allow decline if the current user is actually the assignee
  const canDecline = isAssigned && 
                     currentUser && 
                     actualAssignee && 
                     currentUser.accountId === actualAssignee.accountId;

  return (
    <>
      {cacheInitialised && (
        <>
          <Inline space="space.200">
            <Button onClick={() => {
              invoke('resetCache')
                .then((res) => {
                  setCacheInitialised(res);
                  view.refresh();
                });
            }}>
              Reset Cache
            </Button>
          </Inline>
        </>
      )}

      <Text weight="bold">Auto-Assignment Recommendation</Text>

      {assignee && (
        <Stack space="space.100" >
          <Text>Recommended: {assignee.displayName}</Text>
          <Inline space="space.200">
            {canAssign && (
              <Button onClick={handleAutoAssign} appearance="primary">
                Assign to {assignee.displayName}
              </Button>
            )}

            {canDecline && (
              <Button onClick={handleDecline} appearance="warning">
                Decline Assignment
              </Button>
            )}

            <Button onClick={() => setShowDetailsModal(true)}>
              View Details
            </Button>
          </Inline>
        </Stack>
      )}

      {alternatives.length > 0 && (
        <>
          <Text></Text>
          <Text weight="bold">Alternative Candidates:</Text>
          {alternatives.slice(0, 3).map((alt, idx) => (
            <Text key={idx}>
              {idx + 1}. {alt.displayName} (score: {alt.finalScore?.toFixed(2)})
            </Text>
          ))}
        </>
      )}

      {/* Details Modal */}
      <ModalTransition>
        {showDetailsModal && (
          <Modal onClose={() => setShowDetailsModal(false)}>
            <ModalHeader>
              <ModalTitle>Assignment Details - {assignee?.displayName}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              {renderDetailedEvidence()}
            </ModalBody>
          </Modal>
        )}
      </ModalTransition>
    </>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);