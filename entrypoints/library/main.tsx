/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createRoot } from 'react-dom/client';
import '@/src/ui/style.css';
import '../options/options.css';
import './library.css';
import { ErrorBoundary } from '@/src/ui/ErrorBoundary';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary surface="library page">
    <App />
  </ErrorBoundary>,
);
