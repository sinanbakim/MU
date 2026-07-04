// =========================================================================
// Lightweight custom context menu for canvas right-click

export class ContextMenu {
	constructor(targetElement) {
		this.target = targetElement;
		this.el = null;
		this.callbacks = {};
		this.onBeforeShow = null;
		this._build();
		this._bind();
	}

	_build() {
		this.el = document.createElement('div');
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

	_bind() {
		this.target.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			if (this.onBeforeShow) this.onBeforeShow();
			this._show(e.clientX, e.clientY);
		});
		window.addEventListener('click', () => this.hide());
		window.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') this.hide();
		});
	}

	_show(x, y) {
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

			const item = document.createElement('div');
			item.textContent = label;
			Object.assign(item.style, {
				padding: '6px 16px',
				cursor: 'pointer',
			});
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

		// Clamp position to viewport
		this.el.style.left = x + 'px';
		this.el.style.top = y + 'px';
		this.el.style.display = 'block';

		// Adjust if overflowing
		const rect = this.el.getBoundingClientRect();
		if (rect.right > window.innerWidth) {
			this.el.style.left = window.innerWidth - rect.width - 4 + 'px';
		}
		if (rect.bottom > window.innerHeight) {
			this.el.style.top = window.innerHeight - rect.height - 4 + 'px';
		}
	}

	hide() {
		this.el.style.display = 'none';
	}

	setItems(items) {
		this.callbacks = items;
	}
}

// =========================================================================
