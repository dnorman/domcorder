import React, { useEffect, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { PagePlayerComponent } from '@domcorder/browser-core';

interface Recording {
    id: string;
    filename: string;
    size: number;
    created: string;
}

interface PlayerWrapperProps {
    recording: Recording | null;
}

const spin = keyframes`
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
`;

const PlayerWrapperContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
`;

const PlayerHeader = styled.div`
  padding: 1rem;
  background: white;
  border-bottom: 1px solid #dee2e6;
`;

const RecordingInfo = styled.div`
  h3 {
    margin: 0 0 0.5rem 0;
    color: #2c3e50;
    font-size: 1.1rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const RecordingDetails = styled.div`
  display: flex;
  gap: 1rem;
  font-size: 0.9rem;
  color: #6c757d;
`;

const NoRecording = styled.div`
  text-align: center;
  color: #6c757d;

  h3 {
    margin: 0 0 0.5rem 0;
    color: #6c757d;
  }

  p {
    margin: 0;
    font-size: 0.9rem;
  }
`;

const Overlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const OverlayContent = styled.div`
  text-align: center;
  padding: 2rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
`;

const Spinner = styled.div`
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  animation: ${spin} 1s linear infinite;
  margin: 0 auto 1rem auto;
`;

const Progress = styled.p`
  font-size: 0.9rem;
  color: #6c757d;
  margin-top: 0.5rem;
`;

const ErrorContent = styled(OverlayContent)`
  h4 {
    margin: 0 0 1rem 0;
    color: #e74c3c;
  }

  button {
    background: #e74c3c;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    margin-top: 1rem;

    &:hover {
      background: #c0392b;
    }
  }
`;

const PlayerContainerWrapper = styled.div`
  flex: 1;
  position: relative;
  max-height: 100%;
  overflow: hidden;
`;

const PlayerContainer = styled.div<{ $hasRecording: boolean }>`
  width: 100%;
  height: 100%;
  background: ${props => props.$hasRecording ? '#f0f0f0' : '#f8f9fa'};
  max-height: 100%;
  overflow: hidden;
`;

export const PlayerWrapper: React.FC<PlayerWrapperProps> = ({ recording }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<PagePlayerComponent | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);

    useEffect(() => {
        // Only initialize the player when we have a recording to play
        if (recording && containerRef.current && !playerRef.current) {
            try {
                // Create a fresh div element for the PagePlayerComponent
                const playerDiv = document.createElement('div');
                playerDiv.style.width = '100%';
                playerDiv.style.height = '100%';
                containerRef.current.appendChild(playerDiv);

                // Initialize the PagePlayerComponent with the fresh div
                playerRef.current = new PagePlayerComponent(playerDiv);

                // Load the recording once the player is ready
                loadAndPlayRecording(recording);
            } catch (error) {
                console.error('Error initializing PagePlayerComponent:', error);
                setError('Failed to initialize player: ' + (error instanceof Error ? error.message : String(error)));
            }
        }

        // Clean up when recording changes or component unmounts
        return () => {
            if (playerRef.current) {
                // Clear the container completely
                if (containerRef.current) {
                    containerRef.current.innerHTML = '';
                }
                playerRef.current = null;
            }
        };
    }, [recording]);

    const loadAndPlayRecording = async (recording: Recording) => {
        if (!playerRef.current) return;

        try {
            setIsLoading(true);
            setError(null);
            setProgress(null);

            console.log('Loading recording:', recording.filename);

            // Fetch the recording data with streaming
            const response = await fetch(`http://localhost:8723/recording/${recording.filename}`);

            if (!response.ok) {
                throw new Error(`Failed to load recording: ${response.status} ${response.statusText}`);
            }

            if (!response.body) {
                throw new Error('Response body is null');
            }

            const contentLength = response.headers.get('content-length');
            const totalBytes = contentLength ? parseInt(contentLength, 10) : recording.size;
            let loadedBytes = 0;

            // Wait for player to be ready
            await playerRef.current.ready();

            // Create a reader for the response stream
            const reader = response.body.getReader();

            try {
                while (true) {
                    const { done, value } = await reader.read();

                    if (done) {
                        console.log('Finished loading recording');
                        break;
                    }

                    // Update progress
                    loadedBytes += value.length;
                    setProgress({ loaded: loadedBytes, total: totalBytes });

                    // Send chunk to player
                    playerRef.current.handleChunk(value);
                }
            } finally {
                reader.releaseLock();
            }

            setIsLoading(false);
            console.log('Recording playback started');

        } catch (err) {
            console.error('Error loading recording:', err);
            setError(err instanceof Error ? err.message : 'Failed to load recording');
            setIsLoading(false);
        }
    };

    const formatProgress = () => {
        if (!progress) return '';
        const percent = Math.round((progress.loaded / progress.total) * 100);
        const loadedMB = (progress.loaded / 1024 / 1024).toFixed(1);
        const totalMB = (progress.total / 1024 / 1024).toFixed(1);
        return `${percent}% (${loadedMB}/${totalMB} MB)`;
    };

    return (
        <PlayerWrapperContainer>
            <PlayerHeader>
                {recording ? (
                    <RecordingInfo>
                        <h3>🎬 {recording.filename}</h3>
                        <RecordingDetails>
                            <span>📁 {(recording.size / 1024 / 1024).toFixed(1)} MB</span>
                            <span>🕒 {new Date(recording.created).toLocaleString()}</span>
                        </RecordingDetails>
                    </RecordingInfo>
                ) : (
                    <NoRecording>
                        <h3>Select a recording to play</h3>
                        <p>Choose a recording from the list on the right to start playback</p>
                    </NoRecording>
                )}
            </PlayerHeader>

            {isLoading && (
                <Overlay>
                    <OverlayContent>
                        <Spinner />
                        <p>Loading recording...</p>
                        {progress && <Progress>{formatProgress()}</Progress>}
                    </OverlayContent>
                </Overlay>
            )}

            {error && (
                <Overlay>
                    <ErrorContent>
                        <h4>❌ Error</h4>
                        <p>{error}</p>
                        <button onClick={() => recording && loadAndPlayRecording(recording)}>
                            Try Again
                        </button>
                    </ErrorContent>
                </Overlay>
            )}

            <PlayerContainerWrapper>
                <PlayerContainer
                    ref={containerRef}
                    $hasRecording={!!recording}
                />
            </PlayerContainerWrapper>
        </PlayerWrapperContainer>
    );
};