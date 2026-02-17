/**
 * Error Boundary System for Frontend
 * 
 * Provides:
 * - Global error handling
 * - User-friendly error display
 * - Error recovery options
 * - Error logging
 */

(function(global) {
  'use strict';

  const ErrorBoundary = {
    errors: [],
    maxErrors: 10,
    onErrorHandler: null,
    
    /**
     * Initialize the error boundary
     */
    init() {
      // Catch unhandled errors
      window.addEventListener('error', (event) => {
        this.handleError(event.error || new Error(event.message), {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        });
        event.preventDefault();
      });

      // Catch unhandled promise rejections
      window.addEventListener('unhandledrejection', (event) => {
        const error = event.reason instanceof Error 
          ? event.reason 
          : new Error(String(event.reason));
        this.handleError(error, { type: 'unhandledrejection' });
        event.preventDefault();
      });

      // Override console.error to catch logged errors
      const originalConsoleError = console.error;
      console.error = (...args) => {
        const message = args.map(a => String(a)).join(' ');
        if (message.includes('Error:') || message.includes('error')) {
          this.handleError(new Error(message), { type: 'console.error' });
        }
        originalConsoleError.apply(console, args);
      };

      console.log('[ErrorBoundary] Initialized');
    },

    /**
     * Handle an error
     */
    handleError(error, context = {}) {
      const errorRecord = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        message: error.message || 'Unknown error',
        stack: error.stack || '',
        context,
        timestamp: Date.now(),
        recovered: false
      };

      this.errors.push(errorRecord);
      if (this.errors.length > this.maxErrors) {
        this.errors.shift();
      }

      console.error('[ErrorBoundary] Error caught:', errorRecord);

      // Call custom handler if set
      if (this.onErrorHandler) {
        try {
          this.onErrorHandler(errorRecord);
        } catch (handlerError) {
          console.error('[ErrorBoundary] Handler error:', handlerError);
        }
      }

      // Show user-friendly error UI
      this.showErrorUI(errorRecord);

      // Log to server (if available)
      this.logError(errorRecord);
    },

    /**
     * Show error UI to user
     */
    showErrorUI(error) {
      let container = document.getElementById('error-boundary-container');
      
      if (!container) {
        container = document.createElement('div');
        container.id = 'error-boundary-container';
        container.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 99999;
          max-width: 400px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        document.body.appendChild(container);
      }

      const errorEl = document.createElement('div');
      errorEl.className = 'error-boundary-toast';
      errorEl.style.cssText = `
        background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
        color: white;
        padding: 16px;
        border-radius: 8px;
        margin-bottom: 10px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease-out;
      `;
      
      errorEl.innerHTML = `
        <div style="display: flex; align-items: start; gap: 12px;">
          <div style="flex-shrink: 0; width: 24px; height: 24px;">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 24px; height: 24px;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-1.964-1.333-2.732 0L3.732 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div style="flex: 1;">
            <div style="font-weight: 600; margin-bottom: 4px;">Something went wrong</div>
            <div style="font-size: 14px; opacity: 0.9; margin-bottom: 12px;">
              ${this.escapeHtml(error.message.slice(0, 100))}
            </div>
            <div style="display: flex; gap: 8px;">
              <button onclick="ErrorBoundary.retry('${error.id}')" style="
                background: rgba(255,255,255,0.2);
                border: none;
                color: white;
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 13px;
              ">Retry</button>
              <button onclick="ErrorBoundary.dismiss('${error.id}')" style="
                background: transparent;
                border: 1px solid rgba(255,255,255,0.3);
                color: white;
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 13px;
              ">Dismiss</button>
            </div>
          </div>
        </div>
      `;

      container.appendChild(errorEl);

      // Auto-dismiss after 10 seconds
      setTimeout(() => {
        if (errorEl.parentNode) {
          errorEl.style.animation = 'slideOut 0.3s ease-in forwards';
          setTimeout(() => errorEl.remove(), 300);
        }
      }, 10000);
    },

    /**
     * Retry after error
     */
    retry(errorId) {
      const error = this.errors.find(e => e.id === errorId);
      if (error) {
        error.recovered = true;
        this.dismiss(errorId);
        
        // Try to recover
        if (error.context.type === 'unhandledrejection') {
          // For promise rejections, just refresh the relevant component
          console.log('[ErrorBoundary] Attempting recovery for promise rejection');
        } else {
          // For other errors, reload the page
          window.location.reload();
        }
      }
    },

    /**
     * Dismiss error
     */
    dismiss(errorId) {
      const container = document.getElementById('error-boundary-container');
      if (container) {
        const toasts = container.querySelectorAll('.error-boundary-toast');
        toasts.forEach(toast => {
          if (toast.innerHTML.includes(errorId)) {
            toast.style.animation = 'slideOut 0.3s ease-in forwards';
            setTimeout(() => toast.remove(), 300);
          }
        });
      }
    },

    /**
     * Log error to server
     */
    async logError(error) {
      try {
        await fetch('/api/log-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: error.message,
            stack: error.stack,
            context: error.context,
            timestamp: error.timestamp,
            url: window.location.href,
            userAgent: navigator.userAgent
          })
        });
      } catch (logError) {
        // Silently fail - don't create error loop
      }
    },

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },

    /**
     * Set custom error handler
     */
    onError(handler) {
      this.onErrorHandler = handler;
    },

    /**
     * Get all recorded errors
     */
    getErrors() {
      return [...this.errors];
    },

    /**
     * Clear all errors
     */
    clearErrors() {
      this.errors = [];
      const container = document.getElementById('error-boundary-container');
      if (container) {
        container.innerHTML = '';
      }
    }
  };

  // Add CSS animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(100%);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);

  // Expose globally
  global.ErrorBoundary = ErrorBoundary;

  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ErrorBoundary.init());
  } else {
    ErrorBoundary.init();
  }

})(typeof window !== 'undefined' ? window : global);