import React, { useEffect, useRef } from 'react';
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

    // Create the bookmarklet code that loads the injection script
    const bookmarkletCode = `javascript:(function(){
    if(window.DomCorder){
      console.log('DomCorder already loaded');
      return;
    }
    const script=document.createElement('script');
    script.src='http://localhost:5173/inject.js?t='+Date.now();
    script.onload=function(){
      console.log('DomCorder injection script loaded');
    };
    script.onerror=function(){
      alert('Failed to load DomCorder. Make sure the player is running at localhost:5173');
    };
    document.head.appendChild(script);
  })()`.replace(/\s+/g, ' ');

    // Set the href after component mounts to bypass React's security check
    useEffect(() => {
        if (linkRef.current) {
            linkRef.current.href = bookmarkletCode;
        }
    }, [bookmarkletCode]);

    return (
        <BookmarkletContainer>
            <BookmarkletLink
                ref={linkRef}
                href="#" // Placeholder href to avoid React warning
                title="Drag this to your bookmarks bar to record any page"
            >
                🎬 Record this page
            </BookmarkletLink>
            <Instructions>
                ← Drag to bookmarks bar
            </Instructions>
        </BookmarkletContainer>
    );
};
