import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BundlingProto } from './BundlingProto';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BundlingProto />
  </StrictMode>,
);
