import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';

const BookmarkletContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.5rem;
`;

const BookmarkletLink = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: #e74c3c;
  color: white;
  padding: 8px 16px;
  text-decoration: none;
  border-radius: 6px;
  font-weight: 600;
  font-size: 0.9rem;
  transition: all 0.2s ease;
  cursor: grab;

  &:hover {
    background: #c0392b;
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(231, 76, 60, 0.3);
  }

  &:active {
    cursor: grabbing;
    transform: translateY(0);
  }
`;

const Instructions = styled.span`
  font-size: 0.8rem;
  opacity: 0.7;
  font-style: italic;
`;

export const BookmarkletButton: React.FC = () => {
    const linkRef = useRef<HTMLAnchorElement>(null);
    const [injectionScript, setInjectionScript] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);

    // Load the injection script content (already minified at build time)
    useEffect(() => {
        fetch('/inject.js')
            .then(response => response.text())
            .then(scriptContent => {
                console.log(`Injection script size: ${scriptContent.length} chars`);
                setInjectionScript(scriptContent);
                setIsLoading(false);
            })
            .catch(error => {
                console.error('Failed to load injection script:', error);
                setIsLoading(false);
            });
    }, []);

    // Create the bookmarklet code with inlined script
    const bookmarkletCode = injectionScript ? `javascript:(function(){
if(window.DomCorder){
console.log('DomCorder already loaded');
return;
}
try{
${injectionScript}
}catch(e){
console.error('DomCorder injection failed:',e);
alert('Failed to load DomCorder: '+e.message);
}
})();` : '';

    // Log bookmarklet size for debugging
    useEffect(() => {
        if (bookmarkletCode) {
            console.log(`Final bookmarklet size: ${bookmarkletCode.length} chars`);
            if (bookmarkletCode.length > 124000) {
                console.warn('⚠️ Bookmarklet may be too large for some browsers (>124k chars)');
            }
        }
    }, [bookmarkletCode]);

    // Set the href after component mounts and script is loaded
    useEffect(() => {
        if (linkRef.current && bookmarkletCode) {
            linkRef.current.href = bookmarkletCode;
        }
    }, [bookmarkletCode]);

    return (
        <BookmarkletContainer>
            <BookmarkletLink
                ref={linkRef}
                href={bookmarkletCode || "#"} // Use bookmarklet code or placeholder
                title={isLoading ? "Loading injection script..." : "Drag this to your bookmarks bar to record any page"}
                style={{ opacity: isLoading ? 0.5 : 1, pointerEvents: isLoading ? 'none' : 'auto' }}
            >
                {isLoading ? '⏳ Loading...' : '🎬 Record this page'}
            </BookmarkletLink>
            <Instructions>
                {isLoading ? 'Loading injection script...' : '← Drag to bookmarks bar'}
            </Instructions>
        </BookmarkletContainer>
    );
};
