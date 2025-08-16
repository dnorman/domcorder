import React from 'react';

interface BookmarkletButtonProps {
    port: number;
}

export const BookmarkletButton: React.FC<BookmarkletButtonProps> = ({ port }) => {
    const bookmarkletCode = `javascript:(function(){const s=document.createElement('script');s.src='http://localhost:${port}/inject.js?t='+Date.now();document.head.appendChild(s);})()`;

    return (
        <div className="bookmarklet">
            <h3>Bookmarklet</h3>
            <p>Drag this to your bookmarks bar:</p>
            <a
                href={bookmarkletCode}
                style={{
                    display: 'inline-block',
                    background: '#007acc',
                    color: 'white',
                    padding: '8px 16px',
                    textDecoration: 'none',
                    borderRadius: '4px',
                    fontWeight: 'bold'
                }}
            >
                📸 DomCorder
            </a>
        </div>
    );
}; 