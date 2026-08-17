/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { i18n } from '#i18n';

interface Props {
  /** Where this boundary sits, e.g. "popup" — shown so a report is actionable. */
  surface: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Without this, a render error leaves an extension page completely blank: there
 * is no browser error UI for `moz-extension://` pages, and the popup would just
 * be a white box. Showing the message beats showing nothing.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Extension pages have no error reporting; the console is all a user can be
    // asked to copy from.
    console.error(`[tabstack-bookmarks] ${this.props.surface} crashed`, error, info);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash" role="alert">
        <h1>{i18n.t('crash.title')}</h1>
        <p className="help">{i18n.t('crash.help', [this.props.surface])}</p>
        <pre>{error.message}</pre>
        <div className="actions">
          <button className="primary" onClick={() => location.reload()}>
            {i18n.t('common.reload')}
          </button>
          <button onClick={() => this.setState({ error: null })}>
            {i18n.t('crash.tryAgain')}
          </button>
        </div>
      </div>
    );
  }
}
