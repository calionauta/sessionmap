import React, { useState, useEffect } from 'react';
import { HostView } from './components/HostView';
import { ClientView } from './components/ClientView';

export default function App() {
  const [isClientMode, setIsClientMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const search = window.location.search;
      const hash = window.location.hash;
      return (
        search.includes('view=client') ||
        search.includes('client=1') ||
        search.includes('client=true') ||
        hash.includes('#client')
      );
    }
    return false;
  });

  useEffect(() => {
    const handlePopState = () => {
      const search = window.location.search;
      const hash = window.location.hash;
      setIsClientMode(
        search.includes('view=client') ||
        search.includes('client=1') ||
        search.includes('client=true') ||
        hash.includes('#client')
      );
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  if (isClientMode) {
    return <ClientView />;
  }

  return <HostView />;
}
