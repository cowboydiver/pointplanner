import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import { App } from './components/App'
import { MapClutterPrototype } from './prototypes/MapClutterPrototype'

// PROTOTYPE escape hatch — `?proto=map-clutter` renders the throwaway clutter
// comparison instead of the app. Remove with the prototype.
const isProto = new URLSearchParams(window.location.search).get('proto') === 'map-clutter'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isProto ? <MapClutterPrototype /> : <App />}
  </StrictMode>,
)
