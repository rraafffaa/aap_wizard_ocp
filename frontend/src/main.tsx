import React from 'react';
import ReactDOM from 'react-dom/client';
import '@patternfly/patternfly/patternfly.css';
import './styles/app.css';
import './styles/themes.css';
import './styles/animations.css';
import './styles/responsive.css';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
