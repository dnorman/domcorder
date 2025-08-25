import type { KeyPressed } from '@domcorder/proto-ts';

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
  shiftLabel?: string; // Shifted character (displayed on top)
  row: number;
  col: number;
  width?: number; // Relative width (1 = normal key, 1.5 = wider key, etc.)
  arrowType?: 'up' | 'down' | 'left' | 'right'; // Special positioning for arrow keys
  expand?: boolean; // Whether this key should expand to fill remaining space
}

/**
 * Compact QWERTY keyboard layout definition with uniform row widths and inverted T arrows
 */
const KEYBOARD_LAYOUT: KeyDefinition[] = [
  // Row 0 - Function keys (13 keys total, wider to match 15 unit row width)
  { code: 'Escape', label: 'esc', row: 0, col: 0, width: 1.2, expand: true },
  { code: 'F1', label: 'F1', row: 0, col: 1, width: 1.2 },
  { code: 'F2', label: 'F2', row: 0, col: 2, width: 1.2 },
  { code: 'F3', label: 'F3', row: 0, col: 3, width: 1.2 },
  { code: 'F4', label: 'F4', row: 0, col: 4, width: 1.2 },
  { code: 'F5', label: 'F5', row: 0, col: 5, width: 1.2 },
  { code: 'F6', label: 'F6', row: 0, col: 6, width: 1.2 },
  { code: 'F7', label: 'F7', row: 0, col: 7, width: 1.2 },
  { code: 'F8', label: 'F8', row: 0, col: 8, width: 1.2 },
  { code: 'F9', label: 'F9', row: 0, col: 9, width: 1.2 },
  { code: 'F10', label: 'F10', row: 0, col: 10, width: 1.2 },
  { code: 'F11', label: 'F11', row: 0, col: 11, width: 1.2 },
  { code: 'F12', label: 'F12', row: 0, col: 12, width: 1.2 },

  // Row 1 - Number row (15 units total)
  { code: 'Backquote', label: '`', shiftLabel: '~', row: 1, col: 0 },
  { code: 'Digit1', label: '1', shiftLabel: '!', row: 1, col: 1 },
  { code: 'Digit2', label: '2', shiftLabel: '@', row: 1, col: 2 },
  { code: 'Digit3', label: '3', shiftLabel: '#', row: 1, col: 3 },
  { code: 'Digit4', label: '4', shiftLabel: '$', row: 1, col: 4 },
  { code: 'Digit5', label: '5', shiftLabel: '%', row: 1, col: 5 },
  { code: 'Digit6', label: '6', shiftLabel: '^', row: 1, col: 6 },
  { code: 'Digit7', label: '7', shiftLabel: '&', row: 1, col: 7 },
  { code: 'Digit8', label: '8', shiftLabel: '*', row: 1, col: 8 },
  { code: 'Digit9', label: '9', shiftLabel: '(', row: 1, col: 9 },
  { code: 'Digit0', label: '0', shiftLabel: ')', row: 1, col: 10 },
  { code: 'Minus', label: '-', shiftLabel: '_', row: 1, col: 11 },
  { code: 'Equal', label: '=', shiftLabel: '+', row: 1, col: 12 },
  { code: 'Backspace', label: '⌫', row: 1, col: 13, width: 2.5, expand: true },

  // Row 2 - QWERTY row (15 units total)
  { code: 'Tab', label: '→|', row: 2, col: 0, width: 2.5, expand: true },
  { code: 'KeyQ', label: 'Q', row: 2, col: 1 },
  { code: 'KeyW', label: 'W', row: 2, col: 2 },
  { code: 'KeyE', label: 'E', row: 2, col: 3 },
  { code: 'KeyR', label: 'R', row: 2, col: 4 },
  { code: 'KeyT', label: 'T', row: 2, col: 5 },
  { code: 'KeyY', label: 'Y', row: 2, col: 6 },
  { code: 'KeyU', label: 'U', row: 2, col: 7 },
  { code: 'KeyI', label: 'I', row: 2, col: 8 },
  { code: 'KeyO', label: 'O', row: 2, col: 9 },
  { code: 'KeyP', label: 'P', row: 2, col: 10 },
  { code: 'BracketLeft', label: '[', shiftLabel: '{', row: 2, col: 11 },
  { code: 'BracketRight', label: ']', shiftLabel: '}', row: 2, col: 12 },
  { code: 'Backslash', label: '\\', shiftLabel: '|', row: 2, col: 13, width: 1 },

  // Row 3 - ASDF row (15 units total)
  { code: 'CapsLock', label: '⇪', row: 3, col: 0, width: 2.25, expand: true },
  { code: 'KeyA', label: 'A', row: 3, col: 1 },
  { code: 'KeyS', label: 'S', row: 3, col: 2 },
  { code: 'KeyD', label: 'D', row: 3, col: 3 },
  { code: 'KeyF', label: 'F', row: 3, col: 4 },
  { code: 'KeyG', label: 'G', row: 3, col: 5 },
  { code: 'KeyH', label: 'H', row: 3, col: 6 },
  { code: 'KeyJ', label: 'J', row: 3, col: 7 },
  { code: 'KeyK', label: 'K', row: 3, col: 8 },
  { code: 'KeyL', label: 'L', row: 3, col: 9 },
  { code: 'Semicolon', label: ';', shiftLabel: ':', row: 3, col: 10 },
  { code: 'Quote', label: "'", shiftLabel: '"', row: 3, col: 11 },
  { code: 'Enter', label: '↵', row: 3, col: 12, width: 2.5 },

  // Row 4 - ZXCV row (15 units total)
  { code: 'ShiftLeft', label: '⇧', row: 4, col: 0, width: 3, expand: true },
  { code: 'KeyZ', label: 'Z', row: 4, col: 1 },
  { code: 'KeyX', label: 'X', row: 4, col: 2 },
  { code: 'KeyC', label: 'C', row: 4, col: 3 },
  { code: 'KeyV', label: 'V', row: 4, col: 4 },
  { code: 'KeyB', label: 'B', row: 4, col: 5 },
  { code: 'KeyN', label: 'N', row: 4, col: 6 },
  { code: 'KeyM', label: 'M', row: 4, col: 7 },
  { code: 'Comma', label: ',', shiftLabel: '<', row: 4, col: 8 },
  { code: 'Period', label: '.', shiftLabel: '>', row: 4, col: 9 },
  { code: 'Slash', label: '/', shiftLabel: '?', row: 4, col: 10 },
  { code: 'ShiftRight', label: '⇧', row: 4, col: 11, width: 3, expand: true },

  // Row 5 - Bottom row with inverted T arrow cluster (15 units total for proper width)
  { code: 'ControlLeft', label: 'fn', row: 5, col: 0, width: 1.1 },
  { code: 'MetaLeft', label: '⌃', row: 5, col: 1, width: 1.1 },
  { code: 'AltLeft', label: '⌥', row: 5, col: 2, width: 1.1 },
  { code: 'MetaRight', label: '⌘', row: 5, col: 3, width: 1.1 },
  { code: 'Space', label: '', row: 5, col: 4, width: 6.75, expand: true },
  { code: 'AltRight', label: '⌘', row: 5, col: 5, width: 1.1 },
  { code: 'ControlRight', label: '⌥', row: 5, col: 6, width: 1.1 },
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
  private shadowRoot: ShadowRoot | null = null;
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
  public simulateKeyPress(keyData: KeyPressed): void {
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
   * Create the keyboard DOM structure with Shadow DOM
   */
  private createKeyboard(): void {
    // Create main keyboard container
    this.keyboardElement = document.createElement('div');
    this.keyboardElement.className = 'typing-simulator-keyboard';

    // Create shadow root
    this.shadowRoot = this.keyboardElement.attachShadow({ mode: 'open' });

    // Create adopted stylesheet
    this.createAdoptedStylesheet();

    // Create keyboard container within shadow DOM
    const keyboardContainer = document.createElement('div');
    keyboardContainer.className = 'keyboard-simulator';

    // Create key elements
    this.createKeys(keyboardContainer);

    // Initially hidden
    this.keyboardElement.style.display = 'none';
    this.keyboardElement.style.opacity = '0';
    this.keyboardElement.style.transition = `opacity ${this.config.fadeOutDuration}ms ease-in-out`;

    // Add to shadow DOM
    this.shadowRoot.appendChild(keyboardContainer);

    // Add to parent container
    this.parentContainer.appendChild(this.keyboardElement);
  }

  /**
   * Create and attach adopted stylesheet to shadow root
   */
  private createAdoptedStylesheet(): void {
    if (!this.shadowRoot) return;

    const stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(`
      .keyboard-simulator {
        height: auto;
        background-color: #2a2a2a;
        border: 2px solid #444;
        border-radius: 8px;
        padding: 10px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        color: #fff;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 4px;
        box-sizing: border-box;
      }

      .keyboard-row {
        display: flex;
        gap: 4px;
        align-items: center;
        justify-content: flex-start;
      }

      .keyboard-row-0 {
        height: 32px;
      }

      .keyboard-row-1,
      .keyboard-row-2,
      .keyboard-row-3,
      .keyboard-row-4,
      .keyboard-row-5 {
        height: 36px;
      }

      .keyboard-key {
        background-color: #4a4a4a;
        border: 1px solid #666;
        border-radius: 3px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: default;
        user-select: none;
        transition: background-color ${this.config.keyHighlightDuration}ms ease;
        font-weight: 500;
        min-width: 0;
        text-align: center;
        flex-shrink: 0;
        flex-grow: 0;
      }

      .keyboard-key.expand {
        flex-grow: 1;
      }

      .keyboard-key.highlighted {
        background-color: #7a7a7a;
      }

      .keyboard-key.function-key {
        font-size: 9px;
      }

      .keyboard-key.arrow-key {
        font-size: 10px;
      }

      .keyboard-key.regular-key {
        font-size: 12px;
      }

      .keyboard-key.long-label {
        font-size: 10px;
      }

      .keyboard-key.dual-character {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        line-height: 1;
        font-size: 10px;
      }

      .keyboard-key.dual-character .top-char {
        font-size: 8px;
        line-height: 1;
        margin-bottom: 3px;
      }

      .keyboard-key.dual-character .bottom-char {
        font-size: 10px;
        line-height: 1;
      }

      .arrow-container {
        display: flex;
        align-items: flex-end;
        height: 33px;
        gap: 4px;
      }

      .up-down-container {
        display: flex;
        flex-direction: column;
        gap: 2px;
        width: 32px;
        height: 32px;
        justify-content: flex-end;
      }
    `);

    this.shadowRoot.adoptedStyleSheets = [stylesheet];
  }

  /**
   * Create individual key elements
   */
  private createKeys(keyboardContainer: HTMLElement): void {
    // Create a container for each row (6 rows for compact keyboard)
    const rows: HTMLElement[] = [];

    for (let i = 0; i < 6; i++) {
      const row = document.createElement('div');
      row.className = `keyboard-row keyboard-row-${i}`;
      rows.push(row);
      keyboardContainer.appendChild(row);
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
    arrowContainer.className = 'arrow-container';

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
    upDownContainer.className = 'up-down-container';

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

    // Handle dual-character keys (keys with shiftLabel)
    if (keyDef.shiftLabel) {
      key.classList.add('dual-character');
      key.innerHTML = `<div class="top-char">${keyDef.shiftLabel}</div><div class="bottom-char">${keyDef.label}</div>`;
    } else {
      key.textContent = keyDef.label;
    }

    // Add specific classes based on key type
    const isFunction = keyDef.row === 0;
    const isArrow = !!keyDef.arrowType;

    if (isFunction) {
      key.classList.add('function-key');
    } else if (isArrow) {
      key.classList.add('arrow-key');
    } else {
      key.classList.add('regular-key');
    }

    if (keyDef.label.length > 2 && keyDef.row !== 1) {
      key.classList.add('long-label');
    }

    // Add expand class if specified
    if (keyDef.expand) {
      key.classList.add('expand');
    }

    // Set flex-basis based on key width
    const baseWidth = 32;
    let keyWidth: number;
    let keyHeight: string;

    if (isFunction) {
      keyWidth = (keyDef.width || 1) * baseWidth;
      keyHeight = '28px';
    } else if (isArrow) {
      if (keyDef.arrowType === 'left' || keyDef.arrowType === 'right') {
        keyWidth = 32;
        keyHeight = '14px';
      } else {
        keyWidth = 14;
        keyHeight = '14px';
      }
    } else {
      keyWidth = (keyDef.width || 1) * baseWidth;
      keyHeight = '32px';
    }

    key.style.flexBasis = `${keyWidth}px`;
    key.style.height = keyHeight;

    return key;
  }

  /**
   * Highlight a specific key
   */
  private highlightKey(keyCode: string): void {
    const keyElement = this.keyElements.get(keyCode);
    if (!keyElement) return;

    // Add highlight class
    keyElement.classList.add('highlighted');

    // Remove highlight after duration
    setTimeout(() => {
      keyElement.classList.remove('highlighted');
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
