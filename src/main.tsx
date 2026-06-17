import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import { App } from './components/App'
import { parseMapParam, stashPendingMap } from './lib/pendingMap'

// Capture a share-invite deep link (`?map=<id>`) before React mounts, then strip
// it from the URL. Stashing it in sessionStorage lets it survive a manual
// sign-in (whose own magic-link redirect doesn't carry the param); the registry
// consumes it once the map list is loaded.
const pendingMapId = parseMapParam(window.location.search)
if (pendingMapId) {
  stashPendingMap(window.sessionStorage, pendingMapId)
  const params = new URLSearchParams(window.location.search)
  params.delete('map')
  const qs = params.toString()
  window.history.replaceState(
    null,
    '',
    window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash,
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
