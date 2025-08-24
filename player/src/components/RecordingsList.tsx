import React, { useState, useEffect } from 'react';
import styled from 'styled-components';

interface Recording {
    id: string;
    filename: string;
    size: number;
    created: string;
}

interface RecordingsListProps {
    onRecordingSelect: (recording: Recording) => void;
    selectedRecording: Recording | null;
}

const RecordingsListContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const RecordingsHeader = styled.div`
  padding: 1rem;
  border-bottom: 1px solid #dee2e6;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8f9fa;

  h2 {
    margin: 0;
    font-size: 1.2rem;
    color: #2c3e50;
  }

  button {
    background: #3498db;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;

    &:hover {
      background: #2980b9;
    }

    &:disabled {
      background: #bdc3c7;
      cursor: not-allowed;
    }
  }
`;

const RecordingsContent = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
`;

const StatusMessage = styled.div`
  text-align: center;
  padding: 2rem;
  color: #6c757d;
`;

const ErrorMessage = styled(StatusMessage)`
  p {
    color: #e74c3c;
    margin-bottom: 1rem;
  }

  button {
    background: #e74c3c;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
  }
`;

const EmptyState = styled(StatusMessage)`
  .hint {
    font-size: 0.8rem;
    opacity: 0.7;
  }
`;

const RecordingsGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const RecordingItem = styled.div<{ selected: boolean }>`
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 1rem;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-color: ${props => props.selected ? '#3498db' : '#dee2e6'};
  background: ${props => props.selected ? '#e3f2fd' : 'white'};

  &:hover {
    border-color: #3498db;
    box-shadow: 0 2px 4px rgba(52, 152, 219, 0.1);
  }
`;

const RecordingInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const RecordingFilename = styled.div`
  font-weight: 500;
  color: #2c3e50;
  margin-bottom: 0.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RecordingMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.8rem;
  color: #6c757d;
`;

const RecordingActions = styled.div`
  margin-left: 1rem;
`;

const PlayButton = styled.button`
  background: #27ae60;
  color: white;
  border: none;
  padding: 0.5rem;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1rem;
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background: #229954;
  }
`;

export const RecordingsList: React.FC<RecordingsListProps> = ({
    onRecordingSelect,
    selectedRecording
}) => {
    const [recordings, setRecordings] = useState<Recording[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchRecordings();
    }, []);

    const fetchRecordings = async () => {
        try {
            setLoading(true);
            setError(null);

            const response = await fetch('http://localhost:8723/recordings');
            if (!response.ok) {
                throw new Error(`Failed to fetch recordings: ${response.status}`);
            }

            const data = await response.json();
            setRecordings(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load recordings');
            console.error('Error fetching recordings:', err);
        } finally {
            setLoading(false);
        }
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const formatDate = (dateString: string): string => {
        const date = new Date(dateString);
        return date.toLocaleString();
    };

    if (loading) {
        return (
            <RecordingsListContainer>
                <RecordingsHeader>
                    <h2>Recordings</h2>
                    <button disabled>
                        🔄 Refresh
                    </button>
                </RecordingsHeader>
                <RecordingsContent>
                    <StatusMessage>Loading recordings...</StatusMessage>
                </RecordingsContent>
            </RecordingsListContainer>
        );
    }

    if (error) {
        return (
            <RecordingsListContainer>
                <RecordingsHeader>
                    <h2>Recordings</h2>
                    <button onClick={fetchRecordings}>
                        🔄 Refresh
                    </button>
                </RecordingsHeader>
                <RecordingsContent>
                    <ErrorMessage>
                        <p>❌ {error}</p>
                        <button onClick={fetchRecordings}>Try Again</button>
                    </ErrorMessage>
                </RecordingsContent>
            </RecordingsListContainer>
        );
    }

    return (
        <RecordingsListContainer>
            <RecordingsHeader>
                <h2>Recordings ({recordings.length})</h2>
                <button onClick={fetchRecordings}>
                    🔄 Refresh
                </button>
            </RecordingsHeader>

            <RecordingsContent>
                {recordings.length === 0 ? (
                    <EmptyState>
                        <p>No recordings found</p>
                        <p className="hint">Start recording with the bookmarklet to see recordings here</p>
                    </EmptyState>
                ) : (
                    <RecordingsGrid>
                        {recordings.map((recording) => (
                            <RecordingItem
                                key={recording.id}
                                selected={selectedRecording?.id === recording.id}
                                onClick={() => onRecordingSelect(recording)}
                            >
                                <RecordingInfo>
                                    <RecordingFilename title={recording.filename}>
                                        {recording.filename}
                                    </RecordingFilename>
                                    <RecordingMeta>
                                        <span>📁 {formatFileSize(recording.size)}</span>
                                        <span>🕒 {formatDate(recording.created)}</span>
                                    </RecordingMeta>
                                </RecordingInfo>
                                <RecordingActions>
                                    <PlayButton
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onRecordingSelect(recording);
                                        }}
                                    >
                                        ▶️
                                    </PlayButton>
                                </RecordingActions>
                            </RecordingItem>
                        ))}
                    </RecordingsGrid>
                )}
            </RecordingsContent>
        </RecordingsListContainer>
    );
};