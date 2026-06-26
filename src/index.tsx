import React from 'react';
import ReactDOM from 'react-dom/client';
import { Loader2 } from 'lucide-react';
import App from './App';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginPage } from './components/auth/LoginPage';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

/** Gate: show spinner while validating, login page if signed out, else the app. */
const Gate: React.FC = () => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#0a0a0a] text-neutral-500">
        <Loader2 size={28} className="animate-spin" />
      </div>
    );
  }
  return user ? <App /> : <LoginPage />;
};

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AuthProvider>
      <Gate />
    </AuthProvider>
  </React.StrictMode>
);
