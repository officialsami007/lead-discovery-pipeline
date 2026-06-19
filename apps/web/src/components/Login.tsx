const DEMO_USERS = [
  {
    id: '1A',
    name: 'Alex Morgan',
    email: 'alex@northstar.demo',
    organization: 'Northstar Hotels',
    credits: 10
  },
  {
    id: '1B',
    name: 'Bailey Chen',
    email: 'bailey@harborview.demo',
    organization: 'Harborview Group',
    credits: 2
  },
  {
    id: '1C',
    name: 'Casey Reyes',
    email: 'casey@meridian.demo',
    organization: 'Meridian Consulting',
    credits: 50
  },
  {
    id: '1D',
    name: 'Dana Park',
    email: 'dana@atlas.demo',
    organization: 'Atlas Group',
    credits: 100
  },
  {
    id: '1E',
    name: 'Jordan Silva',
    email: 'jordan@solaris.demo',
    organization: 'Solaris Ventures',
    credits: 75
  }
] as const;

interface LoginProps {
  onLogin: (userId: string) => Promise<void>;
  loadingUserId: string | null;
  error: string | null;
  knownCredits?: Record<string, number>;
}

export function Login({ onLogin, loadingUserId, error, knownCredits }: LoginProps) {
  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="demo-login-title">
        <p className="eyebrow">Demo access</p>
        <h2 id="demo-login-title">Choose an organization</h2>
        <p className="muted">
          Each identity is isolated to its own organization and credit balance.
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="demo-grid">
          {DEMO_USERS.map((user) => (
            <button
              type="button"
              className="demo-card"
              key={user.id}
              disabled={loadingUserId !== null}
              onClick={() => void onLogin(user.id)}
            >
              <span className="avatar">
                {user.name
                  .split(' ')
                  .map((part) => part[0])
                  .join('')}
              </span>
              <span className="demo-card-copy">
                <strong>{user.name}</strong>
                <small>{user.email}</small>
                <span>{user.organization}</span>
              </span>
              <span className="credit-badge">
                {knownCredits?.[user.id] ?? user.credits} credits
              </span>
              <span className="login-arrow">
                {loadingUserId === user.id ? (
                  'Signing in…'
                ) : (
                  <>
                    Continue
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
