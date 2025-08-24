import type { KeyPressedData } from '../common/protocol';

/**
 * Configuration options for the TypingSimulator
 */
export interface TypingSimulatorConfig {
  keyboardWidth?: number;        // Width of the keyboard in pixels (default: 800)
  keyHighlightDuration?: number; // Duration to highlight a key in ms (default: 150)
  visibleTimeout?: number;       // Time to keep keyboard visible after last keypress in ms (default: 3000)
  fadeOutDuration?: number;      // Duration of fade out animation in ms (default: 1000)
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<TypingSimulatorConfig> = {
  keyboardWidth: 800,
  keyHighlightDuration: 150,
  visibleTimeout: 3000,
  fadeOutDuration: 1000,
};

/**
 * Keyboard layout definition - maps key codes to their visual representation and position
 */
interface KeyDefinition {
  code: string;
  label: string;
  row: number;
  col: number;
  width?: number; // Relative width (1 = normal key, 1.5 = wider key, etc.)
  arrowType?: 'up' | 'down' | 'left' | 'right'; // Special positioning for arrow keys
}

/**
 * Compact QWERTY keyboard layout definition with uniform row widths and inverted T arrows
 */
const KEYBOARD_LAYOUT: KeyDefinition[] = [
  // Row 0 - Function keys (13 keys total, wider to match 15 unit row width)
  { code: 'Escape', label: 'esc', row: 0, col: 0, width: 1.154 },
  { code: 'F1', label: 'F1', row: 0, col: 1, width: 1.154 },
  { code: 'F2', label: 'F2', row: 0, col: 2, width: 1.154 },
  { code: 'F3', label: 'F3', row: 0, col: 3, width: 1.154 },
  { code: 'F4', label: 'F4', row: 0, col: 4, width: 1.154 },
  { code: 'F5', label: 'F5', row: 0, col: 5, width: 1.154 },
  { code: 'F6', label: 'F6', row: 0, col: 6, width: 1.154 },
  { code: 'F7', label: 'F7', row: 0, col: 7, width: 1.154 },
  { code: 'F8', label: 'F8', row: 0, col: 8, width: 1.154 },
  { code: 'F9', label: 'F9', row: 0, col: 9, width: 1.154 },
  { code: 'F10', label: 'F10', row: 0, col: 10, width: 1.154 },
  { code: 'F11', label: 'F11', row: 0, col: 11, width: 1.154 },
  { code: 'F12', label: 'F12', row: 0, col: 12, width: 1.154 },

  // Row 1 - Number row (15 units total)
  { code: 'Backquote', label: '`', row: 1, col: 0 },
  { code: 'Digit1', label: '1', row: 1, col: 1 },
  { code: 'Digit2', label: '2', row: 1, col: 2 },
  { code: 'Digit3', label: '3', row: 1, col: 3 },
  { code: 'Digit4', label: '4', row: 1, col: 4 },
  { code: 'Digit5', label: '5', row: 1, col: 5 },
  { code: 'Digit6', label: '6', row: 1, col: 6 },
  { code: 'Digit7', label: '7', row: 1, col: 7 },
  { code: 'Digit8', label: '8', row: 1, col: 8 },
  { code: 'Digit9', label: '9', row: 1, col: 9 },
  { code: 'Digit0', label: '0', row: 1, col: 10 },
  { code: 'Minus', label: '-', row: 1, col: 11 },
  { code: 'Equal', label: '=', row: 1, col: 12 },
  { code: 'Backspace', label: '⌫', row: 1, col: 13, width: 2 },

  // Row 2 - QWERTY row (15 units total)
  { code: 'Tab', label: '→|', row: 2, col: 0, width: 1.5 },
  { code: 'KeyQ', label: 'q', row: 2, col: 1 },
  { code: 'KeyW', label: 'w', row: 2, col: 2 },
  { code: 'KeyE', label: 'e', row: 2, col: 3 },
  { code: 'KeyR', label: 'r', row: 2, col: 4 },
  { code: 'KeyT', label: 't', row: 2, col: 5 },
  { code: 'KeyY', label: 'y', row: 2, col: 6 },
  { code: 'KeyU', label: 'u', row: 2, col: 7 },
  { code: 'KeyI', label: 'i', row: 2, col: 8 },
  { code: 'KeyO', label: 'o', row: 2, col: 9 },
  { code: 'KeyP', label: 'p', row: 2, col: 10 },
  { code: 'BracketLeft', label: '[', row: 2, col: 11 },
  { code: 'BracketRight', label: ']', row: 2, col: 12 },
  { code: 'Backslash', label: '\\', row: 2, col: 13, width: 2 },

  // Row 3 - ASDF row (15 units total)
  { code: 'CapsLock', label: '⇪', row: 3, col: 0, width: 1.75 },
  { code: 'KeyA', label: 'a', row: 3, col: 1 },
  { code: 'KeyS', label: 's', row: 3, col: 2 },
  { code: 'KeyD', label: 'd', row: 3, col: 3 },
  { code: 'KeyF', label: 'f', row: 3, col: 4 },
  { code: 'KeyG', label: 'g', row: 3, col: 5 },
  { code: 'KeyH', label: 'h', row: 3, col: 6 },
  { code: 'KeyJ', label: 'j', row: 3, col: 7 },
  { code: 'KeyK', label: 'k', row: 3, col: 8 },
  { code: 'KeyL', label: 'l', row: 3, col: 9 },
  { code: 'Semicolon', label: ';', row: 3, col: 10 },
  { code: 'Quote', label: "'", row: 3, col: 11 },
  { code: 'Enter', label: '↵', row: 3, col: 12, width: 3.25 },

  // Row 4 - ZXCV row (15 units total)
  { code: 'ShiftLeft', label: '⇧', row: 4, col: 0, width: 2.25 },
  { code: 'KeyZ', label: 'z', row: 4, col: 1 },
  { code: 'KeyX', label: 'x', row: 4, col: 2 },
  { code: 'KeyC', label: 'c', row: 4, col: 3 },
  { code: 'KeyV', label: 'v', row: 4, col: 4 },
  { code: 'KeyB', label: 'b', row: 4, col: 5 },
  { code: 'KeyN', label: 'n', row: 4, col: 6 },
  { code: 'KeyM', label: 'm', row: 4, col: 7 },
  { code: 'Comma', label: ',', row: 4, col: 8 },
  { code: 'Period', label: '.', row: 4, col: 9 },
  { code: 'Slash', label: '/', row: 4, col: 10 },
  { code: 'ShiftRight', label: '⇧', row: 4, col: 11, width: 3.25 },

  // Row 5 - Bottom row with inverted T arrow cluster (15 units total for proper width)
  { code: 'ControlLeft', label: 'fn', row: 5, col: 0, width: 1.25 },
  { code: 'MetaLeft', label: '⌃', row: 5, col: 1, width: 1.25 },
  { code: 'AltLeft', label: '⌥', row: 5, col: 2, width: 1.25 },
  { code: 'MetaRight', label: '⌘', row: 5, col: 3, width: 1.25 },
  { code: 'Space', label: '', row: 5, col: 4, width: 6 },
  { code: 'AltRight', label: '⌘', row: 5, col: 5, width: 1.25 },
  { code: 'ControlRight', label: '⌥', row: 5, col: 6, width: 1.25 },
  // Arrow cluster: All same size (1 unit each)
  { code: 'ArrowLeft', label: '←', row: 5, col: 7, width: 1, arrowType: 'left' },
  { code: 'ArrowUp', label: '↑', row: 5, col: 8, width: 1, arrowType: 'up' },
  { code: 'ArrowDown', label: '↓', row: 5, col: 8, width: 1, arrowType: 'down' }, // Same col as up
  { code: 'ArrowRight', label: '→', row: 5, col: 9, width: 1, arrowType: 'right' },
];

/**
 * TypingSimulator class - renders a virtual keyboard and highlights keys based on KeyPressedData
 */
export class TypingSimulator {
  private parentContainer: HTMLElement;
  private config: Required<TypingSimulatorConfig>;
  private keyboardElement: HTMLElement | null = null;
  private keyElements: Map<string, HTMLElement> = new Map();
  private isVisible: boolean = false;
  private hideTimeout: number | null = null;

  constructor(parentContainer: HTMLElement, config: TypingSimulatorConfig = {}) {
    this.parentContainer = parentContainer;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.createKeyboard();
  }

  /**
   * Simulate a key press by highlighting the corresponding key
   */
  public simulateKeyPress(keyData: KeyPressedData): void {
    // Show keyboard if hidden
    if (!this.isVisible) {
      this.show();
    }

    // Reset hide timeout
    this.resetHideTimeout();

    // Highlight the main key
    this.highlightKey(keyData.code);

    // Highlight modifier keys
    if (keyData.altKey) {
      this.highlightKey('AltLeft');
    }
    if (keyData.ctrlKey) {
      this.highlightKey('ControlLeft');
    }
    if (keyData.metaKey) {
      // Meta key might be mapped differently on different platforms
      this.highlightKey('MetaLeft');
    }
    if (keyData.shiftKey) {
      this.highlightKey('ShiftLeft');
    }
  }

  /**
   * Show the keyboard
   */
  public show(): void {
    if (!this.keyboardElement) return;
    
    this.isVisible = true;
    this.keyboardElement.style.display = 'block';
    this.keyboardElement.style.opacity = '1';
    this.resetHideTimeout();
  }

  /**
   * Hide the keyboard
   */
  public hide(): void {
    if (!this.keyboardElement) return;
    
    this.isVisible = false;
    this.keyboardElement.style.opacity = '0';
    
    // Hide completely after fade animation
    setTimeout(() => {
      if (this.keyboardElement && !this.isVisible) {
        this.keyboardElement.style.display = 'none';
      }
    }, this.config.fadeOutDuration);
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    
    if (this.keyboardElement) {
      this.keyboardElement.remove();
      this.keyboardElement = null;
    }
    
    this.keyElements.clear();
  }

  /**
   * Create the keyboard DOM structure
   */
  private createKeyboard(): void {
    // Create main keyboard container
    this.keyboardElement = document.createElement('div');
    this.keyboardElement.className = 'typing-simulator-keyboard keyboard-simulator';
    
    // Apply base styles
    this.applyKeyboardStyles();
    
    // Create key elements
    this.createKeys();
    
    // Initially hidden
    this.keyboardElement.style.display = 'none';
    this.keyboardElement.style.opacity = '0';
    
    // Add to parent container
    this.parentContainer.appendChild(this.keyboardElement);
  }

  /**
   * Apply CSS styles to the keyboard
   */
  private applyKeyboardStyles(): void {
    if (!this.keyboardElement) return;

    // Calculate total keyboard width based on actual bottom row (widest row)
    const baseWidth = 32;
    const gap = 2;
    
    // Bottom row actual calculation:
    // fn(40) + ⌃(40) + ⌥(40) + ⌘(40) + Space(192) + ⌘(40) + ⌥(40) + ←(32) + ↑↓(16) + →(32) = 512px
    // + 9 gaps × 2px = 18px
    // Total: 530px + 30px buffer for layout quirks
    const keyboardWidth = 555;
    const padding = 10;

    const styles = {
      position: 'absolute', 
      width: `${keyboardWidth + (padding * 2)}px`, // Include padding in total width
      height: 'auto',
      backgroundColor: '#2a2a2a',
      border: '2px solid #444',
      borderRadius: '8px',
      padding: `${padding}px`,
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      color: '#fff',
      zIndex: '10000',
      transition: `opacity ${this.config.fadeOutDuration}ms ease-in-out`,
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      boxSizing: 'border-box',
    };

    Object.assign(this.keyboardElement.style, styles);
  }

  /**
   * Create individual key elements
   */
  private createKeys(): void {
    if (!this.keyboardElement) return;

    // Create a container for each row (6 rows for compact keyboard)
    const rows: HTMLElement[] = [];
    const baseWidth = 32;
    const gap = 2;
    const totalUnits = 15;
    const totalGaps = 14;
    const rowWidth = (totalUnits * baseWidth) + (totalGaps * gap);
    
    for (let i = 0; i < 6; i++) {
      const row = document.createElement('div');
      row.className = `keyboard-row-${i}`;
      row.style.display = 'flex';
      row.style.gap = '2px';
      row.style.height = i === 0 ? '32px' : '36px'; // Function row is shorter
      row.style.alignItems = 'center';
      row.style.width = `${rowWidth}px`; // Force exact row width
      row.style.justifyContent = 'flex-start';
      rows.push(row);
      this.keyboardElement.appendChild(row);
    }

    // Group keys by row and sort by column
    const keysByRow: KeyDefinition[][] = [[], [], [], [], [], []];
    KEYBOARD_LAYOUT.forEach(keyDef => {
      keysByRow[keyDef.row].push(keyDef);
    });

    // Sort each row by column position
    keysByRow.forEach(row => {
      row.sort((a, b) => a.col - b.col);
    });

    // Create keys in order for each row (no stagger - uniform width rows)
    keysByRow.forEach((rowKeys, rowIndex) => {
      // Handle special arrow key layout for row 5
      if (rowIndex === 5) {
        this.createArrowKeyLayout(rowKeys, rows[rowIndex]);
      } else {
        rowKeys.forEach(keyDef => {
          const keyElement = this.createKeyElement(keyDef);
          this.keyElements.set(keyDef.code, keyElement);
          rows[rowIndex].appendChild(keyElement);
        });
      }
    });
  }

  /**
   * Create special arrow key layout with inverted T arrangement
   */
  private createArrowKeyLayout(rowKeys: KeyDefinition[], rowContainer: HTMLElement): void {
    // Create regular keys first (non-arrow keys)
    const regularKeys = rowKeys.filter(key => !key.arrowType);
    const arrowKeys = rowKeys.filter(key => key.arrowType);

    // Add regular keys
    regularKeys.forEach(keyDef => {
      const keyElement = this.createKeyElement(keyDef);
      this.keyElements.set(keyDef.code, keyElement);
      rowContainer.appendChild(keyElement);
    });

    // Create arrow key container
    const arrowContainer = document.createElement('div');
    arrowContainer.style.display = 'flex';
    arrowContainer.style.alignItems = 'flex-end'; // Bottom align
    arrowContainer.style.height = '36px'; // Full row height
    arrowContainer.style.gap = '2px';

    // Group arrows by position
    const leftArrow = arrowKeys.find(key => key.arrowType === 'left');
    const upArrow = arrowKeys.find(key => key.arrowType === 'up');
    const downArrow = arrowKeys.find(key => key.arrowType === 'down');
    const rightArrow = arrowKeys.find(key => key.arrowType === 'right');

    // Create left arrow
    if (leftArrow) {
      const leftElement = this.createKeyElement(leftArrow);
      this.keyElements.set(leftArrow.code, leftElement);
      arrowContainer.appendChild(leftElement);
    }

    // Create up/down stack container
    const upDownContainer = document.createElement('div');
    upDownContainer.style.display = 'flex';
    upDownContainer.style.flexDirection = 'column';
    upDownContainer.style.gap = '2px';
    upDownContainer.style.width = '16px'; // Match up/down arrow key width (16px)
    upDownContainer.style.height = '34px'; // 16px + 2px gap + 16px = 34px total
    upDownContainer.style.justifyContent = 'flex-end'; // Bottom align the stack

    if (upArrow) {
      const upElement = this.createKeyElement(upArrow);
      this.keyElements.set(upArrow.code, upElement);
      upDownContainer.appendChild(upElement);
    }

    if (downArrow) {
      const downElement = this.createKeyElement(downArrow);
      this.keyElements.set(downArrow.code, downElement);
      upDownContainer.appendChild(downElement);
    }

    arrowContainer.appendChild(upDownContainer);

    // Create right arrow
    if (rightArrow) {
      const rightElement = this.createKeyElement(rightArrow);
      this.keyElements.set(rightArrow.code, rightElement);
      arrowContainer.appendChild(rightElement);
    }

    rowContainer.appendChild(arrowContainer);
  }

  /**
   * Create a single key element
   */
  private createKeyElement(keyDef: KeyDefinition): HTMLElement {
    const key = document.createElement('div');
    key.className = 'keyboard-key';
    key.textContent = keyDef.label;
    
    // Use flex-basis instead of width for better flexbox behavior
    const baseWidth = 32; // Smaller base width for compact layout
    const isFunction = keyDef.row === 0; // Function keys are smaller
    const isArrow = !!keyDef.arrowType; // Arrow keys are smaller
    
    let keyWidth: number;
    let keyHeight: string;
    
    if (isFunction) {
      keyWidth = (keyDef.width || 1) * baseWidth;
      keyHeight = '28px';
    } else if (isArrow) {
      if (keyDef.arrowType === 'left' || keyDef.arrowType === 'right') {
        keyWidth = 32; // All arrow keys are 32px wide to match left/right arrows
        keyHeight = '16px'; // Keep height at 16px
      } else {
        keyWidth = 16; // All arrow keys are 32px wide to match left/right arrows
        keyHeight = '16px'; // Keep height at 16px
      }
    } else {
      keyWidth = (keyDef.width || 1) * baseWidth;
      keyHeight = '32px';
    }
    
    const styles = {
      flexBasis: `${keyWidth}px`,
      flexShrink: '0',
      flexGrow: '0',
      height: keyHeight,
      backgroundColor: '#4a4a4a',
      border: '1px solid #666',
      borderRadius: '3px', // Smaller radius for compact look
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'default',
      userSelect: 'none',
      transition: `background-color ${this.config.keyHighlightDuration}ms ease`,
      fontSize: isFunction ? '9px' : (keyDef.label.length > 2 ? '10px' : '12px'),
      fontWeight: '500', // Less bold for cleaner look
      minWidth: '0',
      textAlign: 'center'
    };

    Object.assign(key.style, styles);
    
    return key;
  }

  /**
   * Highlight a specific key
   */
  private highlightKey(keyCode: string): void {
    const keyElement = this.keyElements.get(keyCode);
    if (!keyElement) return;

    // Apply highlight
    keyElement.style.backgroundColor = '#7a7a7a';
    
    // Remove highlight after duration
    setTimeout(() => {
      keyElement.style.backgroundColor = '#4a4a4a';
    }, this.config.keyHighlightDuration);
  }

  /**
   * Reset the hide timeout
   */
  private resetHideTimeout(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }
    
    this.hideTimeout = window.setTimeout(() => {
      this.hide();
    }, this.config.visibleTimeout);
  }
}
