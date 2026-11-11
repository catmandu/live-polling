import { useEffect, useState } from 'react';
import HostGate from './screens/HostGate.jsx';
import ParticipantScreen from './screens/ParticipantScreen.jsx';

const getRoute = () => (window.location.hash.replace(/^#\/?/, '') === 'host' ? 'host' : 'participant');

export default function App() {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const onHash = () => setRoute(getRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return route === 'host' ? <HostGate /> : <ParticipantScreen />;
}
