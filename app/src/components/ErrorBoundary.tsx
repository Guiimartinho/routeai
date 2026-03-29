import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  showStack: boolean;
  copied: boolean;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, showStack: false, copied: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[RouteAI] Uncaught error:', error);
    console.error('[RouteAI] Component stack:', errorInfo.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleResetProject = () => {
    localStorage.clear();
    window.location.reload();
  };

  handleCopyError = () => {
    const { error } = this.state;
    if (!error) return;
    const text = `${error.message}\n\n${error.stack ?? '(no stack trace)'}`;
    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, showStack, copied } = this.state;

    const btnBase: React.CSSProperties = {
      padding: '10px 20px',
      border: 'none',
      borderRadius: '6px',
      fontSize: '13px',
      fontFamily: "'Inter', -apple-system, sans-serif",
      fontWeight: 600,
      cursor: 'pointer',
      transition: 'opacity 0.15s',
    };

    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0d0f12',
        color: '#e8ecf4',
        fontFamily: "'Inter', -apple-system, sans-serif",
      }}>
        <div style={{
          maxWidth: '560px',
          width: '90%',
          textAlign: 'center',
        }}>
          {/* Icon */}
          <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.6 }}>
            &#x26A0;
          </div>

          {/* Title */}
          <h1 style={{
            fontSize: '24px',
            fontWeight: 700,
            margin: '0 0 8px 0',
            color: '#f05060',
          }}>
            Something went wrong
          </h1>

          {/* Error message */}
          <p style={{
            fontSize: '14px',
            color: '#9ba4b8',
            margin: '0 0 24px 0',
            lineHeight: 1.5,
          }}>
            {error?.message ?? 'An unexpected error occurred.'}
          </p>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginBottom: '24px' }}>
            <button
              onClick={this.handleReload}
              style={{ ...btnBase, background: '#4d9eff', color: '#fff' }}
            >
              Reload App
            </button>
            <button
              onClick={this.handleResetProject}
              style={{ ...btnBase, background: '#3d1a1e', color: '#f05060' }}
            >
              Reset Project
            </button>
            <button
              onClick={this.handleCopyError}
              style={{ ...btnBase, background: '#222839', color: '#9ba4b8' }}
            >
              {copied ? 'Copied!' : 'Copy Error'}
            </button>
          </div>

          {/* Collapsible stack trace */}
          <div>
            <button
              onClick={() => this.setState(s => ({ showStack: !s.showStack }))}
              style={{
                background: 'none',
                border: 'none',
                color: '#5c6478',
                fontSize: '12px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                marginBottom: '8px',
              }}
            >
              {showStack ? '\u25BC Hide stack trace' : '\u25B6 Show stack trace'}
            </button>

            {showStack && error?.stack && (
              <pre style={{
                textAlign: 'left',
                background: '#141720',
                border: '1px solid #222839',
                borderRadius: '6px',
                padding: '14px',
                fontSize: '11px',
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                color: '#9ba4b8',
                overflow: 'auto',
                maxHeight: '240px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {error.stack}
              </pre>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
