import React from 'react';
import { ExclamationTriangleIcon } from '@patternfly/react-icons';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="aap-wizard pf-v6-theme-dark">
        <div className="aap-content" role="alert">
          <div className="aap-content__inner">
            <div className="aap-complete">
              <div className="aap-complete__icon aap-complete__icon--danger">
                <ExclamationTriangleIcon />
              </div>
              <h2 className="aap-complete__title">Something went wrong</h2>
              <p className="aap-complete__subtitle">
                {this.state.error?.message || 'An unexpected error occurred.'}
              </p>
              <div className="aap-code-block aap-mt-lg aap-text-left">
                <div className="aap-code-block__header">
                  <span className="aap-code-block__title">Stack Trace</span>
                </div>
                <div className="aap-code-block__body">
                  {this.state.error?.stack || 'No stack trace available'}
                </div>
              </div>
              <div className="aap-flex-row aap-flex-row--center aap-mt-lg">
                <button
                  className="aap-btn aap-btn--secondary"
                  onClick={() => this.setState({ hasError: false, error: null })}
                >
                  Try Again
                </button>
                <button
                  className="aap-btn aap-btn--primary"
                  onClick={() => {
                    localStorage.clear();
                    window.location.reload();
                  }}
                >
                  Reset &amp; Reload
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
