/* @vitest-environment happy-dom */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Boom({ fail }: { fail: boolean }): React.ReactNode {
  if (fail) throw new Error('render exploded');
  return <p>fine</p>;
}

beforeEach(() => {
  // React logs the caught error; the test asserts on the UI, not the noise.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary surface="popup">
        <Boom fail={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('fine')).toBeTruthy();
  });

  /**
   * The whole point: an extension page has no browser error UI, so an uncaught
   * render error is a blank window with nothing to report.
   */
  it('shows the message and which surface failed instead of a blank page', () => {
    render(
      <ErrorBoundary surface="popup">
        <Boom fail={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Something broke')).toBeTruthy();
    expect(screen.getByText(/The popup hit an error/)).toBeTruthy();
    expect(screen.getByText('render exploded')).toBeTruthy();
  });

  it('offers a way out', () => {
    render(
      <ErrorBoundary surface="options page">
        <Boom fail={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('renders again when asked to try again', () => {
    let fail = true;
    const Flaky = () => {
      if (fail) throw new Error('transient');
      return <p>recovered</p>;
    };

    render(
      <ErrorBoundary surface="popup">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByText('transient')).toBeTruthy();

    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('recovered')).toBeTruthy();
  });

  it('reloads the page on request', () => {
    const original = window.location;
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...original, reload },
      configurable: true,
      writable: true,
    });

    try {
      render(
        <ErrorBoundary surface="popup">
          <Boom fail={true} />
        </ErrorBoundary>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
      expect(reload).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });

  it('logs the surface for a bug report', () => {
    render(
      <ErrorBoundary surface="import page">
        <Boom fail={true} />
      </ErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('import page crashed'),
      expect.any(Error),
      expect.anything(),
    );
  });
});
