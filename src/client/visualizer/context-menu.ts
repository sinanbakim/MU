// Lightweight custom context menu for canvas right-click

export type MenuItems = Record<string, (() => void) | null>;

export class ContextMenu {
  private readonly target: HTMLElement;
  private readonly el: HTMLDivElement;
  private callbacks: MenuItems = {};
  onBeforeShow: (() => void) | null = null;

  constructor(targetElement: HTMLElement) {
    this.target = targetElement;
    this.el = document.createElement('div');
    this._build();
    this._bind();
  }

  private _build(): void {
    this.el.id = 'automation-context-menu';
    Object.assign(this.el.style, {
      position: 'fixed',
      display: 'none',
      zIndex: '300',
      background: '#2a2a2a',
      border: '1px solid #555',
      borderRadius: '6px',
      padding: '4px 0',
      minWidth: '180px',
      fontFamily: 'sans-serif',
      fontSize: '13px',
      color: '#ddd',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    });
    document.body.appendChild(this.el);
  }

  private _bind(): void {
    this.target.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.onBeforeShow?.();
      this._show(e.clientX, e.clientY);
    });
    window.addEventListener('click', () => this.hide());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });
  }

  private _show(x: number, y: number): void {
    this.el.innerHTML = '';

    for (const [label, fn] of Object.entries(this.callbacks)) {
      if (label.startsWith('---')) {
        const sep = document.createElement('div');
        Object.assign(sep.style, {
          height: '1px',
          background: '#444',
          margin: '4px 0',
        });
        this.el.appendChild(sep);
        continue;
      }

      if (!fn) continue;

      const item = document.createElement('div');
      item.textContent = label;
      Object.assign(item.style, { padding: '6px 16px', cursor: 'pointer' });
      item.addEventListener('mouseenter', () => {
        item.style.background = '#3a3a3a';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = '';
      });
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
        this.hide();
      });
      this.el.appendChild(item);
    }

    this.el.style.left = x + 'px';
    this.el.style.top = y + 'px';
    this.el.style.display = 'block';

    const rect = this.el.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      this.el.style.left = window.innerWidth - rect.width - 4 + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      this.el.style.top = window.innerHeight - rect.height - 4 + 'px';
    }
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  setItems(items: MenuItems): void {
    this.callbacks = items;
  }
}
