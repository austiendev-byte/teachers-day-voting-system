import './LoadingScreen.css'

function LoadingScreen({ settings }) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-screen-inner">
        {settings?.developer_emblem_url ? (
          <img
            src={settings.developer_emblem_url}
            alt=""
            className="loading-mark loading-mark-img"
          />
        ) : (
          <span className="loading-mark" aria-hidden="true">TD</span>
        )}

        <p className="loading-title">
          {settings?.election_title || "Teachers' Day"}
        </p>

        <p className="loading-subtitle">
          {settings?.system_name || 'Voting System'}
        </p>

        <span className="loading-bar" aria-hidden="true" />
        <span className="sr-only">Loading</span>
      </div>
    </div>
  )
}

export default LoadingScreen
