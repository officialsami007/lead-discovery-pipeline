const DEMO_USERS = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Alex Morgan',
    email: 'alex@northstar.demo',
    organization: 'Northstar Hotels',
    credits: 10
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Bailey Chen',
    email: 'bailey@harborview.demo',
    organization: 'Harborview Group',
    credits: 2
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    name: 'Casey Reyes',
    email: 'casey@meridian.demo',
    organization: 'Meridian Consulting',
    credits: 50
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    name: 'Dana Park',
    email: 'dana@atlas.demo',
    organization: 'Atlas Group',
    credits: 100
  },
  {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
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
}

export function Login({ onLogin, loadingUserId, error }: LoginProps) {
  return (
    <main className="login-shell">
      <section className="login-intro">
        <div className="brand-mark">LF</div>
        <p className="eyebrow">Leadflow Console</p>
        <h1>Discover qualified leads without losing control of the pipeline.</h1>
        <p className="login-copy">
          A durable, multi-tenant search workflow with atomic credits, asynchronous discovery,
          verification, and a review-ready inbox.
        </p>
        <div className="flow-preview" aria-label="Pipeline stages">
          <span>Search</span>
          <i /> <span>Discover</span>
          <i /> <span>Verify</span>
          <i /> <span>Inbox</span>
        </div>
      </section>
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
              <span className="credit-badge">{user.credits} credits</span>
              <span className="login-arrow">
                {loadingUserId === user.id ? 'Signing in…' : 'Continue →'}
              </span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
