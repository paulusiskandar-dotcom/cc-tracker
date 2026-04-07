import React from 'react';
import ReactDOM from 'react-dom/client';
import AuthGate from './AuthGate';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <AuthGate>
      {({ user, signOut }) => <App user={user} signOut={signOut} />}
    </AuthGate>
  </React.StrictMode>
);