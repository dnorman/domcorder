import React, { useState } from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import { RecordingsList } from './components/RecordingsList';
import { PlayerWrapper } from './components/PlayerWrapper';

interface Recording {
  id: string;
  filename: string;
  size: number;
  created: string;
}

const GlobalStyle = createGlobalStyle`
  * {
    box-sizing: border-box;
  }

  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  #root {
    width: 100%;
    height: 100%;
  }
`;

const AppContainer = styled.div`
  width: 100vw;
  height: 100vh;
  max-width: 100vw;
  max-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: system-ui, -apple-system, sans-serif;
  overflow: hidden;
  margin: 0;
  padding: 0;
`;

const AppHeader = styled.header`
  background: #2c3e50;
  color: white;
  padding: 1rem 2rem;
  border-bottom: 3px solid #3498db;

  h1 {
    margin: 0 0 0.5rem 0;
    font-size: 1.8rem;
    font-weight: 600;
  }

  p {
    margin: 0;
    opacity: 0.8;
    font-size: 0.9rem;
  }
`;

const AppMain = styled.main`
  flex: 1;
  display: flex;
  min-height: 0;
  max-height: 100%;
  overflow: hidden;

  @media (max-width: 768px) {
    flex-direction: column;
  }
`;

const PlayerSection = styled.div`
  flex: 4;
  background: #f8f9fa;
  border-right: 1px solid #dee2e6;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  @media (max-width: 1024px) {
    flex: 3;
  }

  @media (max-width: 768px) {
    flex: 1;
    border-right: none;
    border-bottom: 1px solid #dee2e6;
  }
`;

const RecordingsSection = styled.div`
  flex: 1;
  background: white;
  display: flex;
  flex-direction: column;
  min-width: 280px;
  max-width: 400px;

  @media (max-width: 1024px) {
    min-width: 250px;
    max-width: 350px;
  }

  @media (max-width: 768px) {
    flex: 1;
    min-width: unset;
    max-width: unset;
  }
`;

function App() {
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);

  return (
    <>
      <GlobalStyle />
      <AppContainer>
        <AppHeader>
          <h1>🎬 DomCorder Player</h1>
          <p>Select a recording to play it back</p>
        </AppHeader>

        <AppMain>
          <PlayerSection>
            <PlayerWrapper recording={selectedRecording} />
          </PlayerSection>

          <RecordingsSection>
            <RecordingsList
              onRecordingSelect={setSelectedRecording}
              selectedRecording={selectedRecording}
            />
          </RecordingsSection>
        </AppMain>
      </AppContainer>
    </>
  );
}

export default App;